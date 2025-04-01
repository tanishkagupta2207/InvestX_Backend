const mongoose = require("mongoose");

const UserStocksSchema = new mongoose.Schema({
  portfolio_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "portfolio",
  },
  company_id: {
    type: mongoose.Schema.Types.ObjectId, // Or Number if you're using a numerical ID
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  average_price: {
    type: Number,
    required: true,
    min: 0,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("userstocks", UserStocksSchema);
