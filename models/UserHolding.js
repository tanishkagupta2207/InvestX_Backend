const mongoose = require("mongoose");

const UserHoldingSchema = new mongoose.Schema({
  portfolio_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "portfolio",
  },
   security_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'security_type',
  },
  security_type: {
    type: String,
    required: true,
    enum: ['company', 'mutualfund']
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

module.exports = mongoose.model("userholding", UserHoldingSchema);
