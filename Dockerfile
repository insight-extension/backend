# Use the official Node.js image
FROM node:23.8.0-alpine

# Install pnpm via npm
RUN npm install -g pnpm

# Set the working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install

# Copy the application source code
COPY . .

# Build the application
RUN pnpm run build

# Expose the API port
EXPOSE ${API_PORT}

# Run the application in production mode
CMD ["sh", "-c", "pnpm run db:deploy && pnpm run start:prod"]
