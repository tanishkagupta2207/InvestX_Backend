const connectToMongoDB = require('./dbConnect');
const express = require('express')
const cors = require('cors')
require('dotenv').config();

connectToMongoDB();

const app = express()
const port = process.env.PORT

app.use(express.json());
app.use(cors());

//Available routes
app.use('/api/auth', require('./routes/auth'));
// app.use('/api/notes', require('./routes/notes'));

app.listen(port, () => {
  console.log(`NoteSync Backend listening on port ${port}`)
})