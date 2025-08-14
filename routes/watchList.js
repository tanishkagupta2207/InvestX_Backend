const express = require("express");
const fetchUser = require("../middleware/fetchUser");
const User = require("../models/User");
const UserWatchlist = require("../models/UserWatchlist");
const Company = require("../models/Company");

const router = express.Router();

// POST route for adding a company to a custom watchlist, Login Required
router.post("/add", fetchUser, async (req, res) => {
  const { companyId, watchlistName } = req.body;

  if (!companyId || !watchlistName) {
    return res.status(400).json({
      success: false,
      msg: "Missing company ID or watchlist name.",
    });
  }

  try {
    const userId = req.user.id;

    let userWatchlist = await UserWatchlist.findOne({
      user_id: userId,
    });

    if (!userWatchlist) {
      userWatchlist = new UserWatchlist({
        user_id: userId,
        watchlists: [],
      });
    }

    const customWatchlist = userWatchlist.watchlists.find(
      (list) => list.name === watchlistName
    );

    if (customWatchlist) {
      if (customWatchlist.companies.includes(companyId)) {
        return res.status(201).json({
          success: true,
          msg: `Company already in '${watchlistName}' watchlist.`,
        });
      } else {
        customWatchlist.companies.push(companyId);
      }
    } else {
      userWatchlist.watchlists.push({
        name: watchlistName,
        companies: [companyId],
      });
    }

    await userWatchlist.save();

    res.status(201).json({
      success: true,
      msg: `Company added to '${watchlistName}' successfully!`,
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// DELETE route for removing a company from a custom watchlist
router.delete("/remove", fetchUser, async (req, res) => {
  const { companyId, watchlistName } = req.body;

  if (!companyId || !watchlistName) {
    return res.status(400).json({
      success: false,
      msg: "Missing company ID or watchlist name.",
    });
  }

  try {
    const userId = req.user.id;

    let userWatchlist = await UserWatchlist.findOne({
      user_id: userId,
    });

    if (!userWatchlist) {
      return res.status(404).json({
        success: false,
        msg: "Watchlist not found for user.",
      });
    }

    const customWatchlist = userWatchlist.watchlists.find(
      (list) => list.name === watchlistName
    );

    if (customWatchlist) {
      const companyIndex = customWatchlist.companies.indexOf(companyId);
      if (companyIndex > -1) {
        customWatchlist.companies.splice(companyIndex, 1);
        await userWatchlist.save();
        return res.status(201).json({
          success: true,
          msg: `Company removed from '${watchlistName}' watchlist.`,
        });
      } else {
        return res.status(404).json({
          success: false,
          msg: "Company not found in the specified watchlist.",
        });
      }
    } else {
      return res.status(404).json({
        success: false,
        msg: "Watchlist not found.",
      });
    }
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// GET route for fetching all custom watchlists for a user
router.get("/get", fetchUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const userWatchlist = await UserWatchlist.findOne({
      user_id: userId,
    });

    if (!userWatchlist) {
      return res.status(404).json({
        success: false,
        msg: "No watchlists found for this user.",
      });
    }

    res.status(200).json({
      success: true,
      watchlists: userWatchlist.watchlists,
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// POST route for creating a new custom watchlist
router.post("/create", fetchUser, async (req, res) => {
  const { watchlistName } = req.body;

  if (!watchlistName) {
    return res.status(400).json({
      success: false,
      msg: "Missing watchlist name.",
    });
  }

  try {
    const userId = req.user.id;
    let userWatchlist = await UserWatchlist.findOne({
      user_id: userId,
    });

    if (!userWatchlist) {
      userWatchlist = new UserWatchlist({
        user_id: userId,
        watchlists: [],
      });
    }

    const existingWatchlist = userWatchlist.watchlists.find(
      (list) => list.name === watchlistName
    );

    if (existingWatchlist) {
      return res.status(409).json({
        success: false,
        msg: "A watchlist with this name already exists.",
      });
    }

    userWatchlist.watchlists.push({
      name: watchlistName,
      companies: [],
    });

    await userWatchlist.save();
    res.status(201).json({
      success: true,
      msg: `Watchlist '${watchlistName}' created successfully!`,
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// PUT route for renaming a custom watchlist
router.put("/rename", fetchUser, async (req, res) => {
  const { watchlistId, newName } = req.body;

  if (!watchlistId || !newName) {
    return res.status(400).json({
      success: false,
      msg: "Missing watchlist ID or new watchlist name.",
    });
  }

  try {
    const userId = req.user.id;
    let userWatchlist = await UserWatchlist.findOne({
      user_id: userId,
    });

    if (!userWatchlist) {
      return res.status(404).json({
        success: false,
        msg: "No watchlists found for this user.",
      });
    }

    const watchlistToRename = userWatchlist.watchlists.find(
      (list) => list._id.toString() === watchlistId
    );

    if (!watchlistToRename) {
      return res.status(404).json({
        success: false,
        msg: `Watchlist not found.`,
      });
    }

    const newNameExists = userWatchlist.watchlists.find(
      (list) => list.name === newName
    );

    if (newNameExists) {
      return res.status(409).json({
        success: false,
        msg: `A watchlist with the name '${newName}' already exists.`,
      });
    }

    watchlistToRename.name = newName;
    await userWatchlist.save();

    res.status(200).json({
      success: true,
      msg: `Watchlist renamed to '${newName}' successfully!`,
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// DELETE route for deleting a custom watchlist
router.delete("/delete", fetchUser, async (req, res) => {
  const { watchlistId } = req.body;

  if (!watchlistId) {
    return res.status(400).json({
      success: false,
      msg: "Watchlist ID is required.",
    });
  }

  try {
    const userId = req.user.id;
    const userWatchlist = await UserWatchlist.findOne({
      user_id: userId,
    });

    if (!userWatchlist) {
      return res.status(404).json({
        success: false,
        msg: "No watchlists found for this user.",
      });
    }

    const initialWatchlistCount = userWatchlist.watchlists.length;
    userWatchlist.watchlists = userWatchlist.watchlists.filter(
      (list) => list._id.toString() !== watchlistId
    );

    if (userWatchlist.watchlists.length === initialWatchlistCount) {
      return res.status(404).json({
        success: false,
        msg: `Watchlist not found.`,
      });
    }

    await userWatchlist.save();
    res.status(200).json({
      success: true,
      msg: `Watchlist deleted successfully!`,
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// GET route for fetching a specific custom watchlist
router.post("/getCustom", fetchUser, async (req, res) => {
  const { watchlistName } = req.body;

  try {
    const userId = req.user.id;
    const userWatchlist = await UserWatchlist.findOne({
      user_id: userId,
    }).populate({
      path: "watchlists.companies",
      model: Company,
      select: "symbol name",
    });

    if (!userWatchlist) {
      return res.status(404).json({
        success: false,
        msg: "No watchlists found for this user.",
      });
    }

    const specificWatchlist = userWatchlist.watchlists.find(
      (list) => list.name === watchlistName
    );

    if (!specificWatchlist) {
      return res.status(404).json({
        success: false,
        msg: `Watchlist '${watchlistName}' not found.`,
      });
    }

    res.status(200).json({
      success: true,
      watchlist: specificWatchlist,
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

module.exports = router;