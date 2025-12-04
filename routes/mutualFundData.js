const router = require("express").Router();
const Securities = require("../models/Securities");
const MutualFund = require("../models/MutualFund");
const fetchUser = require("../middleware/fetchUser");

// --- 1. NAV Data Fetching API Endpoint (History) ---
// --- 1. NAV Data Fetching API Endpoint (History) ---
router.post("/data", fetchUser, async (req, res) => {
  const { security_id, range } = req.body;

  if (!security_id || !range) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters: security_id, range",
    });
  }

  try {
    // 1. Get the current time in New York (Consistent with Stock Logic)
    const nowNY = DateTime.now().setZone("America/New_York");
    
    let startNY;
    const interval = "daily"; // Mutual funds are always daily in this context

    // 2. Calculate the Start Date based on NY Time
    // We use the same fluent API (.minus) as the stock logic
    if (range === "1M") {
      startNY = nowNY.minus({ months: 1 }).startOf("day");
    } else if (range === "6M") {
      startNY = nowNY.minus({ months: 6 }).startOf("day");
    } else if (range === "1Y") {
      startNY = nowNY.minus({ years: 1 }).startOf("day");
    } else if (range === "2Y") {
      startNY = nowNY.minus({ years: 2 }).startOf("day");
    } else if (range === "3Y") {
      startNY = nowNY.minus({ years: 3 }).startOf("day");
    } else {
      // Reject intraday ranges (1D, 5D) which are not applicable to MF history here
      return res.status(400).json({
        success: false,
        error:
          "Invalid range parameter for Mutual Fund. Please use '1M', '6M', '1Y', '2Y', or '3Y'.",
      });
    }

    // 3. Convert the NY Start Time to a JS Date (UTC) for the DB Query
    const start = startNY.toJSDate();

    const mutualFund = await MutualFund.findOne({ _id: security_id });
    if (!mutualFund) {
      return res
        .status(404)
        .json({ success: false, error: "Mutual Fund not found" });
    }

    // 4. Query the Securities collection
    // Using $gte: start (UTC) matches the logic in stockData.js
    const data = await Securities.find({
      security_id: security_id,
      security_type: "mutualfund",
      granularity: interval,
      date: { $gte: start, $lte: new Date() },
    }).sort({ date: 1 });

    res.json({ success: true, mutualFund: mutualFund, data });
  } catch (error) {
    console.error("Error fetching mutual fund NAV data by date range:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch mutual fund NAV data" });
  }
});

// --- 2. Mutual Fund Details and Latest NAV Endpoint ---
router.post("/details", fetchUser, async (req, res) => {
    const { security_id } = req.body;
    if (!security_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: security_id",
      });
    }
    try {
        const data = await MutualFund.findOne({ _id: security_id });
        if (!data) {
            return res.status(404).json({ success: false, error: "Mutual Fund not found" });
        }

        // Use current date as the cutoff for fetching the latest NAV
        const now = new Date(); 

        const latestNav = await Securities.findOne({
          security_id: security_id,
          security_type: "mutualfund",
          granularity: "daily",
          date: { $lte: now },
        })
            .sort({ date: -1 })
            .limit(1);

        res.json({
          success: true,
          data: data,
          // Return NAV instead of close_price
          current_nav: latestNav ? latestNav.nav : 0, 
        });

    } catch (error) {
  	  console.error("Error fetching Mutual Fund Details:", error);
  	  res
  	    .status(500)
  	    .json({ success: false, error: "Failed to fetch Mutual Fund Details." });
    }
});

// --- 3. Mutual Fund Categories (Group by the 'category' field) ---
router.get("/categories", fetchUser, async (req, res) => {
    try {
        // Group mutual funds by the 'category' field (e.g., Large_Cap, Mid_Cap)
        const mutualFunds = await MutualFund.find({}, "category name fund_house _id").lean();
        
        if (!mutualFunds || mutualFunds.length === 0) {
            return res.json({ success: true, data: {} });
        }
        
        const groupedData = {}; 
        for (const fund of mutualFunds) {
          if (!fund.category || !fund.name || !fund._id) {
            continue;
  	      }
  	      const category = fund.category;
  	      const fundInfo = {
  	        name: fund.name,
  	        fund_house: fund.fund_house, // Added Fund House for extra info
  	        security_id: fund._id.toString(),
  	      };
  	      if (!groupedData[category]) {
  	        groupedData[category] = [];
  	      }
  	      groupedData[category].push(fundInfo);
  	    }
        // Sort the funds within each category by name
  	    for (const category in groupedData) {
  	      groupedData[category].sort((a, b) => a.name.localeCompare(b.name));
  	    }

  	    res.json({ success: true, data: groupedData });
    } catch (error) {
  	  console.error("Server error: Failed to process mutual fund categories.", error);
  	  res.status(500).json({
  	    success: false,
  	    error: "Server error: Failed to process mutual fund categories.",
  	  });
    }
});

module.exports = router;