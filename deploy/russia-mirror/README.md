# AWUN regional mirror

This small Nginx container exposes AWUN's own hosted frontend and API through a
second HTTPS hostname. It is intended for beta users whose network cannot open
the primary Render hostname.

1. Create a container service in a provider reachable from the target region.
2. Build this directory as a Docker image and expose container port `8080`.
3. Attach your HTTPS domain, for example `https://ru.example.com`.
4. Verify `https://ru.example.com/health` returns HTTP 200.
5. In GitHub open **Settings → Secrets and variables → Actions → Variables**,
   create `AWUN_MIRROR_URL` and set it to the HTTPS domain.
6. Run **Mobile beta builds** again. Android and iOS will contain automatic
   primary-to-mirror failover.

This mirror does not proxy YouTube video or audio. YouTube results play only
through the official embedded player and remain subject to YouTube availability.
