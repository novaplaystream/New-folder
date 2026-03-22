# Use Node.js LTS
FROM node:20-slim

WORKDIR /app

# Install dependencies first (better cache)
COPY package*.json ./
RUN npm install --omit=dev

# Copy app source
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
