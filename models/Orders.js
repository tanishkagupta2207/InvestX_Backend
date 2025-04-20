const mongoose = require("mongoose");

const OrdersSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    portfolio_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "portfolio",
      required: true,
    },
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "company",
      required: true,
    },
    order_type: {
      type: String,
      enum: ["Buy", "Sell"],
      required: true,
    },
    order_sub_type: {
      type: String,
      enum: ["MARKET", "LIMIT", "STOP_LOSS", "TAKE_PROFIT", "STOP_LIMIT"],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
        type: Number,
    },
    limit_price: {
      type: Number,
      // Required for LIMIT and STOP_LIMIT orders (you might handle this in your logic)
    },
    stop_price: {
      type: Number,
      // Required for STOP_LOSS and STOP_LIMIT orders (you might handle this in your logic)
    },
    take_profit_price: {
      type: Number,
      // Required for TAKE_PROFIT orders (you might handle this in your logic)
    },
    time_in_force: {
      type: String,
      enum: ["DAY", "GTC"], // Good 'Til Canceled, Day
      default: "DAY",
    },
    status: {
      type: String,
      enum: ["PENDING", "FILLED", "PARTIALLY_FILLED", "CANCELED", "REJECTED"],
      default: "PENDING",
    },
    filled_quantity: {
      type: Number,
      default: 0,
    },
    average_fill_price: {
      type: Number,
      default: 0,
    },
    date: {
      type: Date,
      default: Date.now,
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("orders", OrdersSchema);
