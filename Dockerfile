FROM node:14

ENV NODE_ENV production

WORKDIR /usr/src/app
COPY package*.json ./
COPY . .

ENV PORT 8080
EXPOSE 8080

CMD [ "node", "." ]
