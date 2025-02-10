const mongoose = require('mongoose');
require('dotenv').config();

const dbURI = process.env.REACT_APP_DB_URL;

const connectToMongoDB = async () => {
    mongoose.connect(dbURI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));
}

module.exports = connectToMongoDB;