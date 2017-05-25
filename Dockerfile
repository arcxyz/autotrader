FROM node:6.10.3-alpine
WORKDIR /opt/app

ADD . /opt/app

RUN npm install

CMD ["npm","start"]