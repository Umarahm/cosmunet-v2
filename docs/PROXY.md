## PROXY environment variable

This project optionally forwards outbound Anilist requests through a proxy (or list of proxies) via the `PROXY` environment variable.

### Where it is used
- `src/routes/meta/anilist.ts` – passed into `new Anilist(..., { url: process.env.PROXY })`, so every Anilist metadata request (search, info, sources, trending, etc.) can be routed through your proxy.
- Loaded by `dotenv` in `src/main.ts`, so values in `.env` are available on server start.

### Accepted formats
- Single proxy: `https://my-proxy.example.com`
- Multiple proxies (JSON array string): `["https://proxy1.com","https://proxy2.com"]`
  - Keep it as a single-line JSON string in `.env`. The Anilist provider accepts either a string or a string array; when you pass a JSON array string it will be parsed by the provider.
- Leave empty or omit to call Anilist directly (no proxy).

### Configure
1) Edit `.env` (or set in your deploy env):
```
PROXY=https://my-proxy.example.com
# or
PROXY=["https://proxy1.com","https://proxy2.com"]
```
2) Restart the server so `dotenv` reloads the new value.

### Notes / troubleshooting
- The proxy must handle HTTPS requests from the server to Anilist.
- If using multiple proxies, the provider may rotate among them; ensure each endpoint is reachable.
- Logs do not expose the proxy value; verify by checking outbound traffic or by pointing at a proxy that adds headers for confirmation.

