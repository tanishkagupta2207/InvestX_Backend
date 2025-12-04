const express = require("express");
const fetchUser = require("../middleware/fetchUser");
const UserWatchlist = require("../models/UserWatchlist");
// We import these to ensure Mongoose knows about them for population
const Company = require("../models/Company");
const MutualFund = require("../models/MutualFund");

const router = express.Router();

// -------------------------------------------------------------------------
// POST: Add a security to a watchlist
// Accepts: watchlistName, securityId, type ('company' or 'mutualfund')
// -------------------------------------------------------------------------
router.post("/add", fetchUser, async (req, res) => {
  const { security_id, watchlistName, type } = req.body; // Keeping 'security_id' variable name from your frontend request, though it represents securityId

  // Basic Validation
  if (!security_id || !watchlistName || !type) {
    return res.status(400).json({
      success: false,
      msg: "Missing security ID, watchlist name, or type.",
    });
  }

  // Validate Enum types as per schema
  const securityType = type.toLowerCase();
  if (securityType !== 'company' && securityType !== 'mutualfund') {
      return res.status(400).json({ success: false, msg: "Invalid type. Must be 'company' or 'mutualfund'." });
  }

  try {
    const userId = req.user.id;

    // 1. Find or Create UserWatchlist document
    let userWatchlist = await UserWatchlist.findOne({ user_id: userId });

    if (!userWatchlist) {
      userWatchlist = new UserWatchlist({
        user_id: userId,
        watchlists: [],
      });
    }

    // 2. Find the specific watchlist by name
    const targetWatchlist = userWatchlist.watchlists.find(
      (list) => list.name === watchlistName
    );

    // 3. Add Security Logic
    if (targetWatchlist) {
      // Check if security already exists in this watchlist
      const exists = targetWatchlist.securities.some(
        (sec) => sec.security_id.toString() === security_id && sec.security_type === securityType
      );

      if (exists) {
        return res.status(201).json({
          success: true,
          msg: `${securityType === 'company' ? 'Company' : 'Mutual Fund'} already in '${watchlistName}'.`,
        });
      }

      // Push new security object
      targetWatchlist.securities.push({
        security_id: security_id,
        security_type: securityType
      });

    } else {
      // Create new watchlist if it doesn't exist
      userWatchlist.watchlists.push({
        name: watchlistName,
        securities: [{
            security_id: security_id,
            security_type: securityType
        }],
      });
    }

    await userWatchlist.save();

    res.status(201).json({
      success: true,
      msg: `Added to '${watchlistName}' successfully!`,
    });

  } catch (error) {
    console.error("Add to watchlist error:", error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// -------------------------------------------------------------------------
// DELETE: Remove a security from a watchlist
// -------------------------------------------------------------------------
router.delete("/remove", fetchUser, async (req, res) => {
  const { security_id, watchlistName } = req.body; // security_id here acts as securityId

  if (!security_id || !watchlistName) {
    return res.status(400).json({
      success: false,
      msg: "Missing ID or watchlist name.",
    });
  }

  try {
    const userId = req.user.id;
    const userWatchlist = await UserWatchlist.findOne({ user_id: userId });

    if (!userWatchlist) {
      return res.status(404).json({ success: false, msg: "Watchlist not found." });
    }

    const targetWatchlist = userWatchlist.watchlists.find(
      (list) => list.name === watchlistName
    );

    if (targetWatchlist) {
      // Filter out the specific security
      const initialLength = targetWatchlist.securities.length;
      
      targetWatchlist.securities = targetWatchlist.securities.filter(
        (sec) => sec.security_id.toString() !== security_id
      );

      if (targetWatchlist.securities.length < initialLength) {
        await userWatchlist.save();
        return res.status(201).json({
          success: true,
          msg: `Removed from '${watchlistName}' watchlist.`,
        });
      } else {
        return res.status(404).json({
          success: false,
          msg: "Item not found in the specified watchlist.",
        });
      }
    } else {
      return res.status(404).json({ success: false, msg: "Watchlist not found." });
    }
  } catch (error) {
    console.error("Remove from watchlist error:", error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// -------------------------------------------------------------------------
// GET: Fetch all watchlist names (Lite fetch)
// -------------------------------------------------------------------------
router.get("/get", fetchUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const userWatchlist = await UserWatchlist.findOne({ user_id: userId });

    if (!userWatchlist) {
      return res.status(404).json({
        success: false,
        msg: "No watchlists found.",
      });
    }

    res.status(200).json({
      success: true,
      watchlists: userWatchlist.watchlists,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// -------------------------------------------------------------------------
// POST: Create a new empty watchlist
// -------------------------------------------------------------------------
router.post("/create", fetchUser, async (req, res) => {
  const { watchlistName } = req.body;

  if (!watchlistName) {
    return res.status(400).json({ success: false, msg: "Missing watchlist name." });
  }

  try {
    const userId = req.user.id;
    let userWatchlist = await UserWatchlist.findOne({ user_id: userId });

    if (!userWatchlist) {
      userWatchlist = new UserWatchlist({
        user_id: userId,
        watchlists: [],
      });
    }

    // Check duplicates
    if (userWatchlist.watchlists.find((list) => list.name === watchlistName)) {
      return res.status(409).json({
        success: false,
        msg: "A watchlist with this name already exists.",
      });
    }

    // Push new empty watchlist with empty securities array
    userWatchlist.watchlists.push({
      name: watchlistName,
      securities: [], 
    });

    await userWatchlist.save();
    res.status(201).json({
      success: true,
      msg: `Watchlist '${watchlistName}' created!`,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// -------------------------------------------------------------------------
// PUT: Rename a watchlist
// -------------------------------------------------------------------------
router.put("/rename", fetchUser, async (req, res) => {
  const { watchlistId, newName } = req.body;

  if (!watchlistId || !newName) {
    return res.status(400).json({ success: false, msg: "Missing ID or new name." });
  }

  try {
    const userId = req.user.id;
    const userWatchlist = await UserWatchlist.findOne({ user_id: userId });

    if (!userWatchlist) return res.status(404).json({ success: false, msg: "User data not found." });

    const targetList = userWatchlist.watchlists.id(watchlistId); // Mongoose subdoc selector

    if (!targetList) {
      return res.status(404).json({ success: false, msg: "Watchlist not found." });
    }

    // Check if name exists elsewhere
    const nameExists = userWatchlist.watchlists.some(
        (list) => list.name === newName && list._id.toString() !== watchlistId
    );

    if (nameExists) {
      return res.status(409).json({ success: false, msg: `Watchlist '${newName}' already exists.` });
    }

    targetList.name = newName;
    await userWatchlist.save();

    res.status(200).json({
      success: true,
      msg: `Renamed to '${newName}' successfully!`,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// -------------------------------------------------------------------------
// DELETE: Delete an entire watchlist
// -------------------------------------------------------------------------
router.delete("/delete", fetchUser, async (req, res) => {
  const { watchlistId } = req.body;

  if (!watchlistId) return res.status(400).json({ success: false, msg: "Watchlist ID required." });

  try {
    const userId = req.user.id;
    const userWatchlist = await UserWatchlist.findOne({ user_id: userId });

    if (!userWatchlist) return res.status(404).json({ success: false, msg: "User data not found." });

    // Filter out the watchlist by ID
    const initialCount = userWatchlist.watchlists.length;
    userWatchlist.watchlists = userWatchlist.watchlists.filter(
        list => list._id.toString() !== watchlistId
    );

    if (userWatchlist.watchlists.length === initialCount) {
        return res.status(404).json({ success: false, msg: "Watchlist not found." });
    }

    await userWatchlist.save();
    res.status(200).json({ success: true, msg: "Watchlist deleted." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// -------------------------------------------------------------------------
// POST: Get Specific Custom Watchlist (With Population)
// -------------------------------------------------------------------------
router.post("/getCustom", fetchUser, async (req, res) => {
  const { watchlistName } = req.body;

  try {
    const userId = req.user.id;
    
    // Find and Populate
    // Using refPath logic defined in Schema: 'securities.security_type'
    const userWatchlist = await UserWatchlist.findOne({ user_id: userId })
      .populate({
        path: "watchlists.securities.security_id",
        // We select fields common/useful to both Company and MutualFund
        select: "name symbol current_price sector nav fund_house category" 
      });

    if (!userWatchlist) {
      return res.status(404).json({ success: false, msg: "User watchlist not found." });
    }

    const specificWatchlist = userWatchlist.watchlists.find(
      (list) => list.name === watchlistName
    );

    if (!specificWatchlist) {
      return res.status(404).json({ success: false, msg: `Watchlist '${watchlistName}' not found.` });
    }

    res.status(200).json({
      success: true,
      watchlist: specificWatchlist,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

module.exports = router;