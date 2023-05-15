FROM node:19
LABEL nodeVersion="19" 

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm --version

COPY package*.json ./
RUN npm install
# RUN npm ci --only=production
COPY . .
EXPOSE 80 2456/udp
CMD ["/bin/sh", "-c", "node server.js > server.log 2>&1"]