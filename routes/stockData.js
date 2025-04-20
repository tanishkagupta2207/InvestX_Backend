const router = require("express").Router();
const Stocks = require("../models/Stocks");
const Company = require("../models/Company");
const fetchUser = require("../middleware/fetchUser");

// Data Fetching API Endpoint
router.post("/data", fetchUser, async (req, res) => {
  const { company_id, range } = req.body;

  if (!company_id || !range) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters: company_id, range",
    });
  }

  try {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() - 1); // 1 day before today
    const start = new Date(end);
    let interval = "daily"; // Set the interval to daily
    if (range === "1D") {
      // start.setDate(start.getDate() - 1); // 1 day before end date
      interval = "1min";
    } else if (range === "5D") {
      start.setDate(start.getDate() - 4); // 5 days before end date
      interval = "5min";
    } else if (range === "1M") {
      start.setMonth(start.getMonth() - 1); // 1 month before end date
      interval = "daily";
    } else if (range === "6M") {
      start.setMonth(start.getMonth() - 6); // 6 months before end date
      interval = "daily";
    } else if (range === "1Y") {
      start.setFullYear(start.getFullYear() - 1); // 1 year before end date
      interval = "daily";
    } else if (range === "2Y") {
      start.setFullYear(start.getFullYear() - 2); // 2 year before end date
      interval = "daily";
    } else {
      return res.status(400).json({
        success: false,
        error:
          "Invalid range parameter. Please use '1D', '5D', '1M', '6M', '1Y', or '2Y'.",
      });
    }
    start.setHours(0, 0, 0, 0); // Set to start of the day
    start.setMinutes(0);
    start.setSeconds(0);
    start.setMilliseconds(0);

    const company = await Company.findOne({ _id: company_id });
    if (!company) {
      return res
        .status(404)
        .json({ success: false, error: "Company not found" });
    }

    const data = await Stocks.find({
      company_id: company_id,
      granularity: interval,
      date: { $gte: start, $lte: end },
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
  const { company_id } = req.body;
  if (!company_id) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters: company_id",
    });
  }
  try {
    const data = await Company.findOne({ _id: company_id });
    const now = new Date();
    now.setDate(now.getDate() - 1);
    const latestStock = await Stocks.findOne({
      company_id: company_id,
      date: { $lt: now }, // Filter for date less than the current yesterday's time
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
        company_id: company._id.toString(),
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
