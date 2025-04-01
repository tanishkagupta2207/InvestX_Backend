const connectToMongoDB = require('./dbConnect');
const express = require('express')
const cors = require('cors')
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


app.use(cors());

//Available routes
app.use('/api/auth', require('./routes/auth'));
// app.use('/api/notes', require('./routes/notes'));

app.listen(port, () => {
  console.log(`NoteSync Backend listening on port ${port}`)
})