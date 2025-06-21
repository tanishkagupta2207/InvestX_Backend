const express = require("express");
const fetchUser = require("../middleware/fetchUser");
const User = require("../models/User");
const WatchList = require("../models/WatchList");

const router = express.Router();

// POST route for adding Company to watchList, Login Required
router.post("/add", fetchUser, async (req, res) => {
  const { companyId } = req.body;

  if (!companyId) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing Company Details!!!" });
  }

  try {
    //user
    const userId = req.user.id;

    let watchlistItem = await WatchList.findOne({
      user_id: userId,
      company_id: companyId,
    });

    if (watchlistItem) {
      return res
        .status(201)
        .json({ success: true, msg: "Company already in watchlist." });
    } else {
      watchlistItem = new WatchList({
        user_id: userId,
        company_id: companyId,
      });
      await watchlistItem.save();
    }
    res.status(201).json({
      success: true,
      msg: "Company added to WatchList successfully!",
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// POST route for selling action
router.delete("/remove", fetchUser, async (req, res) => {
  const { companyId } = req.body;

  if (!companyId) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing Company Details!!!" });
  }

  try {
    //user
    const userId = req.user.id;

    let watchlistItem = await WatchList.findOne({
      user_id: userId,
      company_id: companyId,
    });

    if (watchlistItem) {
      watchlistItem = await WatchList.findOneAndDelete({
        user_id: userId,
        company_id: companyId,
      });
      return res
        .status(201)
        .json({ success: true, msg: "Company removed from WatchList." });
    } else {
      return res
        .status(404)
        .json({ success: false, msg: "Company not found in watchlist." });
    }
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

router.get("/get", fetchUser, async (req, res) => {
  try {
    //user
    const userId = req.user.id;

    let watchList = await WatchList.find({ user_id: userId });

    res.status(201).json({
      success: true,
      watchList: watchList,
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

module.exports = router;
