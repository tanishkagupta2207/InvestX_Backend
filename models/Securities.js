const mongoose = require("mongoose");

const SecuritiesSchema = new mongoose.Schema({
  security_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'security_type'
  },
  security_type: {
    type: String,
    required: true,
    enum: ['company', 'mutualfund']
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
  granularity: {
    type: String,
    enum: ["1min", "5min", "daily"],
    required: true,
    default: "daily"
  },
  // NAV for Mutual Funds
  nav: {
    type: Number,
  }
});

module.exports = mongoose.model("securities", SecuritiesSchema);
