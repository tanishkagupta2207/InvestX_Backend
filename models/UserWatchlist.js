const mongoose = require("mongoose");

const CustomWatchlistSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  companies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "company",
  }],
  date: {
    type: Date,
    default: Date.now,
  },
});

const UserWatchlistSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true,
    ref: "user",
  },
  watchlists: [CustomWatchlistSchema],
});

module.exports = mongoose.model("userwatchlist", UserWatchlistSchema);