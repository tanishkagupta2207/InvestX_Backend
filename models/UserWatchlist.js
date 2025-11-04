const mongoose = require("mongoose");

const CustomWatchlistSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  securities: [{
    security_id: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'securities.security_type',
      required: true,
    },
    security_type: {
      type: String,
      enum: ['company', 'mutualfund'],
      required: true,
    }
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