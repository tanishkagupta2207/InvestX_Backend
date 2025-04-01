const mongoose = require("mongoose");

const StocksSchema = new mongoose.Schema({
  company_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "company",
  },
  date: {
    type: Date,
    default: Date.now,
  },
  open_price: {
    type: Number,
  },
  close_price: {
    type: Number,
  },
  high_price: {
    type: Number,
  },
  low_price: {
    type: Number,
  },
  volume: {
    type: Number,
  },
});

module.exports = mongoose.model("stocks", StocksSchema);
