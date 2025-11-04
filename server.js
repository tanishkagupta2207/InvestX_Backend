const connectToMongoDB = require('./dbConnect');
const express = require('express')
const cors = require('cors')
const stockDataRoutes = require('./routes/stockData');
const scheduler = require('./routes/Scheduler');
require('dotenv').config();

connectToMongoDB();

const app = express()
const port = process.env.PORT

app.use(express.json());

const corsOptions = {
  origin: 'http://localhost:3000',  // Only allow your frontend to access the backend
  methods: ['GET', 'POST', 'PUT', 'DELETE'],  // Allow GET and POST requests
  allowedHeaders: ['Content-Type', 'Authorization', 'auth-token'],  // Allow these headers in requests
};

app.use(cors(corsOptions));

//Available routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/stock', stockDataRoutes);
app.use('/api/mutualfund', require('./routes/mutualFundData'));
app.use('/api/portfolio', require('./routes/portfolio'));
app.use('/api/transaction', require('./routes/transaction'));
app.use('/api/watchList', require('./routes/watchList'));
app.use('/api/orders', require('./routes/orders'));

app.listen(port, () => {
  console.log(`InvestX Backend listening on port ${port}`)
})