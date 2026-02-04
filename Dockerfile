FROM node:18-slim
WORKDIR /usr/src/app

# install sqlite3 CLI tool
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

# install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# copy source
COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
