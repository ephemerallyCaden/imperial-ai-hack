"""Mass-conserving stochastic density NCA (P2-5). Emulates sim/cellsim.py on its coarse-grained density grid.

State per cell: rho (density, 0..1) + NH hidden channels. Parameters (log Tm, bias) are broadcast as input channels.
Per step (dt = 1/K hour):
  perception: for each state channel, [identity, sobel_x, sobel_y, laplacian] (fixed 3x3 filters, zero pad)
  MLP (1x1, 2 layers) on [perception, params, noise] -> 9 flux logits (8 neighbours + stay), source logit, hidden delta
  flux: frac = softmax(logits); cell i sends rho_i*frac_k*(1-rho_j) to neighbour j (contact inhibition); sent mass
        is subtracted from i and added to j  -> sum(rho) is conserved exactly except through the source and the reservoir
  source: softplus(.) * (1-rho) * dt >= 0 (division; ~0 for WHAD where division is off)
  reservoir: border band of `edge` cells is reset to 1 every step (as in the simulator)
Everything is 3x3 fixed filters + a small MLP, so the JS port is a few loops.
"""
import torch, torch.nn as nn, torch.nn.functional as F

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
    def __init__(self, nh=4, hidden=48, n_params=2, K=2, edge=1, noise=0.1):
        super().__init__()
        self.nh, self.K, self.edge, self.noise, self.n_params = nh, K, edge, noise, n_params
        S = 1 + nh
        self.S = S
        cin = 4 * S + n_params + 1
        self.l1 = nn.Linear(cin, hidden)
        self.l2 = nn.Linear(hidden, 9 + 1 + nh)
        nn.init.zeros_(self.l2.weight); nn.init.zeros_(self.l2.bias)
        self.register_buffer("kern", KERN[:, None].repeat(S, 1, 1, 1).reshape(4 * S, 1, 3, 3))

    def step(self, rho, hid, par, stochastic=True):
        # rho (B,1,H,W) hid (B,nh,H,W) par (B,n_params,1,1)
        B, _, H, W = rho.shape
        x = torch.cat([rho, hid], 1)
        perc = F.conv2d(F.pad(x, (1, 1, 1, 1)), self.kern, groups=self.S)  # (B,4S,H,W)
        z = torch.randn(B, 1, H, W, device=rho.device) if stochastic else torch.zeros(B, 1, H, W, device=rho.device)
        inp = torch.cat([perc, par.expand(B, -1, H, W), z], 1).permute(0, 2, 3, 1)
        out = self.l2(torch.relu(self.l1(inp))).permute(0, 3, 1, 2)
        logits, src, dh = out[:, :9], out[:, 9:10], out[:, 10:]
        if stochastic and self.noise > 0:
            logits = logits + self.noise * torch.randn_like(logits)
        frac = torch.softmax(logits, 1)  # last index = stay
        rp = F.pad(rho, (1, 1, 1, 1), value=1.0)  # outside counts as full -> no flux through the border
        new = rho * frac[:, 8:9]
        for k, (dy, dx) in enumerate(NB):
            nbr = rp[:, :, 1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
            sent = rho * frac[:, k:k + 1] * (1 - nbr)  # i -> j
            new = new + rho * frac[:, k:k + 1] - sent  # keep what was blocked (= rho*frac*nbr)
            # add inflow at j: sent from i = j - (dy,dx)
            sp = F.pad(sent, (1, 1, 1, 1))
            new = new + sp[:, :, 1 - dy:1 - dy + H, 1 - dx:1 - dx + W]
        # sent mass that would leave the grid is blocked because outside = full, so conservation holds
        new = new + F.softplus(src - 3.0) * (1 - rho) / self.K
        hid = hid + dh / self.K
        e = self.edge
        m = torch.zeros_like(new); m[:, :, :e] = 1; m[:, :, -e:] = 1; m[:, :, :, :e] = 1; m[:, :, :, -e:] = 1
        new = new * (1 - m) + m
        return new.clamp(0, 1), hid

    def forward(self, rho0, par, n_frames, stochastic=True):
        """rho0 (B,1,H,W); par (B,n_params). Returns (B,n_frames+1,H,W) density frames (frame 0 = input)."""
        par = par[:, :, None, None]
        rho, hid = rho0, torch.zeros(rho0.shape[0], self.nh, *rho0.shape[2:], device=rho0.device)
        frames = [rho[:, 0]]
        for _ in range(n_frames):
            for _ in range(self.K):
                rho, hid = self.step(rho, hid, par, stochastic)
            frames.append(rho[:, 0])
        return torch.stack(frames, 1)


def norm_params(Tm, bias):
    """Network input encoding of the simulator parameters."""
    import math
    return [math.log(Tm) / 2.0 + 1.5, bias * 2 - 1]
