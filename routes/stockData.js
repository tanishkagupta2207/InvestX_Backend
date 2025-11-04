const router = require("express").Router();
const Securities = require("../models/Securities");
const Company = require("../models/Company");
const fetchUser = require("../middleware/fetchUser");

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
    const start = new Date(); // today
    let interval = "daily"; // Set the interval to daily
    if (range === "1D") {
      interval = "1min";
    } else if (range === "5D") {
      start.setDate(start.getDate() - 4); // 4 days before today(total 5 days including today)
      interval = "5min";
    } else if (range === "1M") {
      start.setMonth(start.getMonth() - 1); // 1 month before today
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
