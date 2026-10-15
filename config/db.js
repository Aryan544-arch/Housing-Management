const mongoose = require('mongoose');

/**
 * Connect to MongoDB using Mongoose.
 * Throws on connection failure so the server startup aborts clearly.
 * @param {string} [uri] - Optional custom MongoDB connection URI
 * @returns {Promise<typeof mongoose>}
 */
async function connectDB(uri) {
  const mongoURI = uri || process.env.MONGODB_URI;

  if (!mongoURI) {
    const error = new Error('MONGODB_URI is not defined in environment variables');
    console.error('Database configuration error:', error.message);
    throw error;
  }

  try {
    const connection = await mongoose.connect(mongoURI);
    console.log(`MongoDB connected: ${connection.connection.host}/${connection.connection.name}`);
    return connection;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error.message);
    throw error;
  }
}

/**
 * Disconnect from MongoDB gracefully.
 * @returns {Promise<void>}
 */
async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  }
}

module.exports = {
  connectDB,
  disconnectDB
};
