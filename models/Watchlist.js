const mongoose = require("mongoose");

const WatchlistSchema = new mongoose.Schema({
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
  date: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("watchlist", WatchlistSchema);