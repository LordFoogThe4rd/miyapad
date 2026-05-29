FROM node:20.19.3

COPY server /app/server
COPY project /app/project
COPY miyapad.html /app/miyapad.html
COPY compile.sh /app/compile.sh

# Compile HTML
WORKDIR /app
RUN /bin/bash compile.sh

# Server expects miyapad.html
RUN mv /app/mikupad_compiled.html /app/miyapad.html

# Compile server
WORKDIR /app/server
RUN npm install --no-audit
ENTRYPOINT [ "node", "server.js" ]
