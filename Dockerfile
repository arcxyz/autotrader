FROM node:6.10.3-slim
WORKDIR /opt/app

ADD . /opt/app

RUN npm install

CMD ["npm","start"]