FROM node:16-buster-slim
WORKDIR /src
COPY . .
RUN yarn
CMD ["yarn", "start"]
