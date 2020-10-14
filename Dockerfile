FROM node:14

# Set the working directory to /testenv
WORKDIR /testenv

ENV NODE_ENV test
ENV PATH /testenv/node_modules/.bin:$PATH

# Start the development server
CMD ["npm", "run", "entrypoint-test"]
