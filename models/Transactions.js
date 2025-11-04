const mongoose = require("mongoose");

const TransactionsSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "user",
  },
  security_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'security_type',
  },
  security_type: {
    type: String,
    required: true,
    enum: ['company', 'mutualfund'],
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
  quantity: {
    type: Number,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("transactions", TransactionsSchema);