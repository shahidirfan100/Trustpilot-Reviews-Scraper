FROM apify/actor-node-playwright-firefox:22-1.58.2

COPY --chown=myuser:myuser package*.json ./
# impit ships its native binary as an optionalDependency selected by os/cpu/libc.
# The base image's bundled npm can crash resolving those (npm "edgesOut" bug), so
# install with a pinned modern npm, keep optional deps, and verify impit loads.
RUN npx --yes npm@11.6.2 install --omit=dev --no-audit --no-fund \
    && node -e "import('impit').then((m) => console.log('impit OK:', Object.keys(m)))" \
    && rm -rf ~/.npm

COPY --chown=myuser:myuser . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent
