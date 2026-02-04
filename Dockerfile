FROM node:18-slim
WORKDIR /usr/src/app

# install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# copy source
COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
