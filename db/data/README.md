# Data Directory

This directory contains the cities data file that is used by the application.

## Important Note

The `cities_data.txt` file is intentionally excluded from version control due to its large size (177.20 MB). This file is required for production deployment.

## Production Deployment

For production deployment, you have several options:

1. **Manual Upload**: 
   - Place the `cities_data.txt` file in this directory before deployment
   - The file should be exactly 177.20 MB in size

2. **Cloud Storage**:
   - Store the file in a cloud storage service (AWS S3, Google Cloud Storage, etc.)
   - Update the application configuration to fetch the file from the cloud storage

3. **Database**:
   - Import the data into a database
   - Update the application to read from the database instead of the file

## Development

For local development, you can:
1. Use a smaller sample of the data
2. Use mock data
3. Download the full dataset from a secure location

Contact the development team for access to the full dataset if needed. 