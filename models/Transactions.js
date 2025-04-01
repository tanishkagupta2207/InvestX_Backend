const mongoose = require("mongoose");

const TransactionsSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "user",
  },
  company_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "company",
  },
  action: {
    type: String,
    enum: ["Buy", "Sell"],
    required: true,
    default: "Buy",
  },
  trade_price: {
    type: Number,
  },
  volume: {
    type: Number,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("transactions", TransactionsSchema);
