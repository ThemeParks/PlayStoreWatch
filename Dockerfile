FROM node:18

ENV NODE_ENV production

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY *.js ./
RUN mkdir ./templates
COPY ./templates/* ./templates/

ENV PORT 8080
EXPOSE 8080

VOLUME /usr/src/app/store.db/

CMD [ "node", "." ]
