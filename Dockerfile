FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create necessary directories
RUN mkdir -p src/app

# Copy environment variables
COPY src/app/.env src/app/.env

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "src/app/index.js"] 