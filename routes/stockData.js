const router = require("express").Router();
const Securities = require("../models/Securities");
const Company = require("../models/Company");
const fetchUser = require("../middleware/fetchUser");
const { DateTime } = require("luxon");

// Data Fetching API Endpoint
router.post("/data", fetchUser, async (req, res) => {
  const { security_id, range } = req.body;

  if (!security_id || !range) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters: security_id, range",
    });
  }

  try {
    // 1. Get the current time in New York
    const nowNY = DateTime.now().setZone("America/New_York");
    
    let startNY;
    let interval = "daily";

    // 2. Calculate the Start Date based on NY Time
    if (range === "1D") {
      // Start of the CURRENT trading day in NY (00:00 ET)
      // This ensures we get the full session regardless of IST time
      startNY = nowNY.startOf("day"); 
      interval = "1min";
    } else if (range === "5D") {
      // Today + 4 previous days = 5 days total
      startNY = nowNY.minus({ days: 4 }).startOf("day");
      interval = "5min";
    } else if (range === "1M") {
      startNY = nowNY.minus({ months: 1 }).startOf("day");
      interval = "daily";
    } else if (range === "6M") {
      startNY = nowNY.minus({ months: 6 }).startOf("day");
      interval = "daily";
    } else if (range === "1Y") {
      startNY = nowNY.minus({ years: 1 }).startOf("day");
      interval = "daily";
    } else if (range === "2Y") {
      startNY = nowNY.minus({ years: 2 }).startOf("day");
      interval = "daily";
    } else {
      return res.status(400).json({
        success: false,
        error:
          "Invalid range parameter. Please use '1D', '5D', '1M', '6M', '1Y', or '2Y'.",
      });
    }

    // 3. Convert the NY Start Time to a JS Date (UTC) for the DB Query
    // MongoDB stores dates in UTC. valid startNY (e.g., 00:00 ET) 
    // will be converted to the correct UTC timestamp (e.g., 05:00 UTC).
    const start = startNY.toJSDate(); 

    const company = await Company.findOne({ _id: security_id });
    if (!company) {
      return res
        .status(404)
        .json({ success: false, error: "Company not found" });
    }

    const data = await Securities.find({
      security_id: security_id,
      security_type: "company",
      granularity: interval,
      // Query >= Start Date (UTC) and <= Now
      date: { $gte: start, $lte: new Date() },
    }).sort({ date: 1 });

    res.json({ success: true, company: company, data });
  } catch (error) {
    console.error("Error fetching stock data by date range:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch stock data" });
  }
});

router.post("/company", fetchUser, async (req, res) => {
  const { security_id } = req.body;
  if (!security_id) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters: security_id",
    });
  }
  try {
    const data = await Company.findOne({ _id: security_id });
    const now = new Date();
    const latestStock = await Securities.findOne({
      security_id: security_id,
      security_type: "company",
      date: { $lte: now },
    })
      .sort({ date: -1 })
      .limit(1);
    
    res.json({
      success: true,
      data: data,
      current_price: latestStock.close_price,
    });

  } catch (error) {
    console.error("Error fetching Company Details:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch Company Details." });
  }
});

router.get("/categories", fetchUser, async (req, res) => {
  try {
    const companies = await Company.find({}, "sector name symbol _id").lean();
    // Handle case where no companies are found
    if (!companies || companies.length === 0) {
      return res.json({ success: true, data: {} });
    }
    const groupedData = {}; // Initialize an empty object to store grouped results
    for (const company of companies) {
      if (!company.sector || !company.symbol || !company._id || !company.name) {
        continue; // Skip the company if essential info is missing
      }
      const sector = company.sector;
      const companyInfo = {
        symbol: company.symbol,
        name: company.name,
        security_id: company._id.toString(),
      };
      if (!groupedData[sector]) {
        groupedData[sector] = [];
      }
      // Push the company info into the array for the correct sector
      groupedData[sector].push(companyInfo);
    }
    for (const sector in groupedData) {
      groupedData[sector].sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    res.json({ success: true, data: groupedData });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server error: Failed to process company categories.",
    });
  }
});

module.exports = router;
