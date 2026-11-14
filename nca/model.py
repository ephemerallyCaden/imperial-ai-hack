"""Mass-conserving stochastic density NCA (P2-5). Emulates sim/cellsim.py on its coarse-grained density grid.

State per cell: rho (density, 0..1) + NH hidden channels. Parameters (log Tm, bias) are broadcast as input channels.
Per step (dt = 1/K hour):
  perception: for each state channel, [identity, sobel_x, sobel_y, laplacian] (fixed 3x3 filters, zero pad)
  MLP (1x1, 2 layers) on [perception, params, noise] -> 9 flux logits (8 neighbours + stay), source logit, hidden delta
  flux: frac = softmax(logits); cell i wants to send rho_i*frac_k*(1-rho_j) to neighbour j, each target caps its total
        inflow at its room -> 0 <= rho <= 1 and sum(rho) conserved exactly (except source and reservoir); see step()
  source: division * sigmoid(.) * (1-rho) / K >= 0. Gate 0 in v1 (frozen rules: mass only enters at the reservoir).
          v2 (follower rule) sets the gate to 1: the follower sim fills a front site without leaving a vacancy (the chain
          behind shifts to the reservoir), so at the coarse level mass appears at the front; the source head is that
          front term (non-negative, capped by the room left after the flux, and gated by the 3x3 max of rho at the
          step start so mass can only appear next to cells, never inside an empty wound interior).
  reservoir: rho = max(rho, R), R = coarse-grained sim reservoir mask (sites refilled every step, fixed at t0)
  hidden channels: tanh-bounded
Everything is 3x3 fixed filters + a small MLP, so the JS port is a few loops.
"""
import os, torch, torch.nn as nn, torch.nn.functional as F

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]  # same order as sim.NB (dy, dx)
KERN = torch.tensor([
    [[0, 0, 0], [0, 1, 0], [0, 0, 0]],
    [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
    [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
    [[1, 2, 1], [2, -12, 2], [1, 2, 1]],
], dtype=torch.float32)
KERN[1:3] /= 8.0
KERN[3] /= 16.0


class NCA(nn.Module):
    """State channels: [rho, R, hid_0..hid_{nh-1}]. R = coarse reservoir fraction (fixed at t0, not updated).
    Layout (JS port must match): perception index = channel*4 + filter (filters: id, sobel_x, sobel_y, laplacian);
    MLP input = [perception (4*S), params (2), noise (1)]; output = [9 flux logits (NB order, then stay), 1 source, nh hidden]."""

    def __init__(self, nh=4, hidden=48, n_params=2, K=2, noise=0.1, division=0.0):
        super().__init__()
        self.nh, self.K, self.noise, self.n_params, self.division = nh, K, noise, n_params, division
        S = 2 + nh
        self.S = S
        cin = 4 * S + n_params + 1
        self.l1 = nn.Linear(cin, hidden)
        self.l2 = nn.Linear(hidden, 9 + 1 + nh)
        nn.init.zeros_(self.l2.weight); nn.init.zeros_(self.l2.bias)
        self.register_buffer("kern", KERN[:, None].repeat(S, 1, 1, 1).reshape(4 * S, 1, 3, 3))
        g = torch.zeros(8, 1, 3, 3); sc = torch.zeros(1, 8, 3, 3)
        for k, (dy, dx) in enumerate(NB):
            g[k, 0, 1 + dy, 1 + dx] = 1.0   # out[i] = x[i + d]
            sc[0, k, 1 - dy, 1 - dx] = 1.0  # out[j] = sum_k x_k[j - d_k]
        self.register_buffer("gather", g, persistent=False); self.register_buffer("scatter", sc, persistent=False)

    def step(self, rho, R, hid, par, stochastic=True):
        """rho, R (B,1,H,W); hid (B,nh,H,W); par (B,n_params,1,1).
        Flux: cell i wants to send out_k = rho_i * frac_k * (1 - rho_j) to neighbour j = i + NB[k]; each target scales all
        its inflows by min(1, room_j / demand_j), room_j = 1 - rho_j (outside the grid: room 0 = wall). So 0 <= rho <= 1
        without clamping and sum(rho) is conserved exactly by the flux. Then: optional source (division, gated by
        self.division, 0 for WHAD), and the reservoir floor rho = max(rho, R) (sim: reservoir sites are refilled)."""
        B, _, H, W = rho.shape
        x = torch.cat([rho, R, hid], 1)
        perc = F.conv2d(F.pad(x, (1, 1, 1, 1)), self.kern, groups=self.S)  # (B,4S,H,W)
        z = torch.randn(B, 1, H, W, device=rho.device) if stochastic else torch.zeros(B, 1, H, W, device=rho.device)
        inp = torch.cat([perc, par.expand(B, -1, H, W), z], 1)
        hdn = torch.relu(F.conv2d(inp, self.l1.weight[:, :, None, None], self.l1.bias))  # per-cell MLP as 1x1 convs
        out = F.conv2d(hdn, self.l2.weight[:, :, None, None], self.l2.bias)
        logits, src, dh = out[:, :9], out[:, 9:10], out[:, 10:]
        if stochastic and self.noise > 0:
            logits = logits + self.noise * torch.randn_like(logits)
        frac = torch.softmax(logits, 1)  # index 8 = stay
        room = (1 - rho).clamp_min(0)  # float guard: rho can exceed 1 by ~1e-7
        # all 8 neighbour shifts as one conv each: GATHER[k] reads x[i + d_k], SCATTER sums x_k[j - d_k] over k
        room_t = F.conv2d(F.pad(room, (1, 1, 1, 1)), self.gather)            # (B,8,H,W) room at target i + d_k (0 outside)
        want = rho * frac[:, :8] * room_t
        demand = F.conv2d(F.pad(want, (1, 1, 1, 1)), self.scatter)          # (B,1,H,W) total inflow wanted into j
        scale = torch.where(demand > room, room / demand.clamp_min(1e-12), torch.ones_like(demand))
        sent = want * F.conv2d(F.pad(scale, (1, 1, 1, 1)), self.gather)
        new = rho - sent.sum(1, keepdim=True) + F.conv2d(F.pad(sent, (1, 1, 1, 1)), self.scatter)
        if self.division:
            near = F.max_pool2d(rho, 3, stride=1, padding=1)  # cells in the 3x3 neighbourhood (zero pad): front only
            add = self.division * near * torch.sigmoid(src - 3.0) * (1 - new) / self.K
            new = new + add
        out = torch.maximum(new, R)
        st = getattr(self, "stats", None)  # optional mass accounting (nca/mass_check.py): per-sample sums
        if st is not None:
            if self.division:  # source added where no cell is in the 3x3 neighbourhood (must be exactly 0)
                st.setdefault("source_isolated", []).append((add * (near == 0)).sum((1, 2, 3)))
            st.setdefault("source", []).append((add if self.division else torch.zeros_like(new)).sum((1, 2, 3)))
            st.setdefault("reservoir", []).append((out - new).sum((1, 2, 3)))
        hid = torch.tanh(hid + dh / self.K)
        return out, hid

    def forward(self, rho0, par, n_frames, R=None, stochastic=True):
        """rho0 (B,1,H,W); par (B,n_params); R (B,1,H,W) reservoir fraction (default 0).
        Returns (B,n_frames+1,H,W) density frames (frame 0 = max(rho0, R))."""
        par = par[:, :, None, None]
        R = torch.zeros_like(rho0) if R is None else R
        rho, hid = torch.maximum(rho0, R), torch.zeros(rho0.shape[0], self.nh, *rho0.shape[2:], device=rho0.device)
        frames = [rho[:, 0]]
        for _ in range(n_frames):
            for _ in range(self.K):
                rho, hid = self.step(rho, R, hid, par, stochastic)
            frames.append(rho[:, 0])
        return torch.stack(frames, 1)


TM_MIN, TM_MAX = 0.05, 5.0   # sim/calibrate.py grid (dt = 0.05 h)
BIAS_MIN, BIAS_MAX = 0.25, 0.9  # agreed with Agent 1 (sim/calibrate.py grid)


def norm_params(Tm, bias, tm_min=TM_MIN, tm_max=TM_MAX):
    """Network input encoding: both roughly in [-1, 1] over the fitted range (v1: Tm 0.05-5; v2 follower: 0.05-50)."""
    import math
    lo, hi = math.log(tm_min), math.log(tm_max)
    return [2 * (math.log(Tm) - lo) / (hi - lo) - 1, 2 * bias - 1]


V1_CONFIG = dict(version="v1", tm_min=TM_MIN, tm_max=TM_MAX, bias_min=BIAS_MIN, bias_max=BIAS_MAX, division=0.0, follow=False)


def config_path(weights):
    return os.path.splitext(weights)[0] + ".config.json"


def load_config(weights):
    """Per-weights config (nca/v2/weights.config.json); missing = the merged v1 model (frozen rules, no source)."""
    import json
    p = config_path(weights)
    return {**V1_CONFIG, **json.load(open(p))} if os.path.exists(p) else dict(V1_CONFIG)


def build(cfg):
    net = NCA(division=cfg["division"]); net.cfg = cfg
    return net


def encode(cfg, Tm, bias):
    return norm_params(Tm, bias, cfg["tm_min"], cfg["tm_max"])
