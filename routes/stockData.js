const router = require("express").Router();
const cron = require("node-cron");
const Stocks = require("../models/Stocks");
const Company = require("../models/Company");
const axios = require("axios");
const fetchUser = require("../middleware/fetchUser");
require("dotenv").config();

// Data Fetching API Endpoint
router.get("/data", fetchUser , async (req, res) => {
  const { company_id, range} = req.body;

  if (!company_id || !range) {
    return res.status(400).json({success:false, error: "Missing required parameters: company_id, range" });
  }

  try {
    const now = new Date();
    const end = new Date(now); 
    end.setDate(end.getDate() - 1); // 1 day before today
    const start = new Date(end);
    let interval = 'daily'; // Set the interval to daily
    if(range === "1D"){
      start.setDate(start.getDate() - 1); // 1 day before end date
      interval = '1min';
    }
    else if(range === "5D"){
      start.setDate(start.getDate() - 5); // 5 days before end date
      interval = '5min';
    }
    else if(range === "1M"){
      start.setMonth(start.getMonth() - 1); // 1 month before end date
      interval = 'daily';
    }
    else if(range === "6M"){
      start.setMonth(start.getMonth() - 6); // 6 months before end date
      interval = 'daily';
    }
    else if(range === "1Y"){
      start.setFullYear(start.getFullYear() - 1); // 1 year before end date
      interval = 'daily';
    }
    else if(range === "2Y"){
      start.setFullYear(start.getFullYear() - 2); // 2 year before end date
      interval = 'daily';
    }
    else{
      return res.status(400).json({success:false, error: "Invalid range parameter. Please use '1D', '5D', '1M', '6M', '1Y', or '2Y'." });
    }
    start.setHours(0, 0, 0, 0); // Set to start of the day
    start.setMinutes(0);
    start.setSeconds(0);
    start.setMilliseconds(0);

    const company = await Company.findOne({ _id : company_id });
    if (!company) {
      return res.status(404).json({success:false, error: "Company not found" });
    }

    const data = await Stocks.find({
      company_id: company_id,
      granularity: interval,
      date: { $gte: start, $lte: end },
    }).sort({ date: 1 });

    res.json({'success': true, company: company, data});
  } catch (error) {
    console.error("Error fetching stock data by date range:", error);
    res.status(500).json({success:false, error: "Failed to fetch stock data" });
  }
});

router.get("/company", fetchUser, async (req, res) => {
  const { company_id} = req.body;
  if (!company_id) {
    return res.status(400).json({success:false, error: "Missing required parameters: company_id" });
  }
  try {
    const data = await Company.findOne({ _id : company_id });
    res.json({'success': true, data});
  } catch (error) {
    console.error("Error fetching Company Details:", error);
    res.status(500).json({success:false, error: "Failed to fetch Company Details." });
  }
});

router.get("/categories", fetchUser, async (req, res) => {
  try {
      const companies = await Company.find({}, 'sector name symbol _id').lean();
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
              company_id: company._id.toString()
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
      res.status(500).json({ success: false, error: "Server error: Failed to process company categories." });
  }
});

// RapidAPI Configuration
const RAPIDAPI_KEY = process.env.REACT_APP_RAPIDAPI_KEY;
const RAPIDAPI_HOSTNAME = process.env.REACT_APP_RAPIDAPI_HOSTNAME;
const RAPIDAPI_BASE_URL_INTRADAY = process.env.REACT_APP_RAPIDAPI_BASE_URL_INTRADAY;

async function fetchAndStoreYesterdayIntradayData(symbol, company_id) {
  const INTRADAY_INTERVAL = "1min";
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setMinutes(0);
    yesterday.setSeconds(0);
    yesterday.setMilliseconds(0);

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayFormatted = `${year}-${month}-${day}`;

    console.log(`Workspaceing data for: ${yesterdayFormatted}`);
    const functionParam = "TIME_SERIES_INTRADAY";

    const options = {
      method: "GET",
      url: RAPIDAPI_BASE_URL_INTRADAY,
      params: {
        datatype: "json",
        function: functionParam,
        symbol: symbol,
        interval: INTRADAY_INTERVAL,
        outputsize: "full", // Fetch all available intraday data for yesterday
      },
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOSTNAME,
      },
    };

    const response = await axios.request(options);
    const data = response.data;

    if (data && data[`Time Series (${INTRADAY_INTERVAL})`]) {
      const timeSeries = data[`Time Series (${INTRADAY_INTERVAL})`];

      for (const timestampStr in timeSeries) {
        const intradayData = timeSeries[timestampStr];
        const timestampDate = new Date(timestampStr);
        const timestampYear = timestampDate.getFullYear();
        const timestampMonth = String(timestampDate.getMonth() + 1).padStart(
          2,
          "0"
        );
        const timestampDay = String(timestampDate.getDate()).padStart(2, "0");
        const timestampDateFormatted = `${timestampYear}-${timestampMonth}-${timestampDay}`;

        // Ensure the data point is from yesterday
        if (timestampDateFormatted === yesterdayFormatted) {
          const newStockData = new Stocks({
            company_id: company_id,
            date: timestampDate,
            open_price: parseFloat(intradayData["1. open"]),
            high_price: parseFloat(intradayData["2. high"]),
            low_price: parseFloat(intradayData["3. low"]),
            close_price: parseFloat(intradayData["4. close"]),
            volume: parseInt(intradayData["5. volume"]),
            granularity: "1min",
          });
          await newStockData.save();
        }
      }
      console.log(
        `Workspaceed and stored 1-min data for ${symbol} for yesterday (${yesterdayFormatted})`
      );
    } else if (data && data.Note) {
      console.warn(`Alpha Vantage API Note for ${symbol}: ${data.Note}`);
    } else if (data && data["Error Message"]) {
      console.error(
        `Alpha Vantage API Error for ${symbol}: ${data["Error Message"]}`
      );
    } else {
      console.warn(
        `No intraday data found for ${symbol} for yesterday (${yesterdayFormatted}) in Alpha Vantage response.`
      );
    }
  } catch (error) {
    console.error(`Error fetching or storing intraday data, `, error.message);
  }
}

// Data Aggregation Function(should aggregate data for yesterday i.e 2 days before exact day today as 1 day behind)
async function aggregateDailyData() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setMinutes(0);
  yesterday.setSeconds(0);
  yesterday.setMilliseconds(0);

  const tomorrowYesterday = new Date(yesterday);
  tomorrowYesterday.setDate(tomorrowYesterday.getDate() + 1);
  tomorrowYesterday.setHours(0, 0, 0, 0);
  tomorrowYesterday.setMinutes(0);
  tomorrowYesterday.setSeconds(0);
  tomorrowYesterday.setMilliseconds(0);

  try {
    const companyIds = await Stocks.distinct("company_id", {
      date: { $gte: yesterday, $lt: tomorrowYesterday },
      granularity: { $in: ["1min", "5min"] },
    });

    for (const companyId of companyIds) {
      const granularData = await Stocks.find({
        company_id: companyId,
        date: { $gte: yesterday, $lt: tomorrowYesterday },
        granularity: { $in: ["1min", "5min"] },
      }).sort({ date: 1 });

      if (granularData.length > 0) {
        const openPrice = granularData[0].open_price;
        const closePrice = granularData[granularData.length - 1].close_price;
        const highPrice = Math.max(
          ...granularData
            .map((item) => item.high_price)
            .filter((price) => price !== undefined)
        );
        const lowPrice = Math.min(
          ...granularData
            .map((item) => item.low_price)
            .filter((price) => price !== undefined)
        );
        const totalVolume = granularData.reduce(
          (sum, item) => sum + (item.volume || 0),
          0
        );

        const dailyData = new Stocks({
          company_id: companyId,
          date: yesterday,
          open_price: openPrice,
          high_price: highPrice,
          low_price: lowPrice,
          close_price: closePrice,
          volume: totalVolume,
          granularity: "daily",
        });

        await dailyData.save();
      }
    }
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    console.log(
      `Successfully aggregated daily data for ${year}-${month}-${day}`
    );
  } catch (error) {
    console.error("Error during daily aggregation:", error);
  }
}

// Data Pruning Function
async function pruneOldGranularData() {
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - 5);
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setMinutes(0);
  cutoffDate.setSeconds(0);
  cutoffDate.setMilliseconds(0);

  try {
    const result = await Stocks.deleteMany({
      granularity: { $in: ["1min", "5min"] },
      date: { $lt: cutoffDate },
    });
    console.log(
      `Successfully pruned ${result.deletedCount} old granular data points.`
    );
  } catch (error) {
    console.error("Error during pruning:", error);
  }
}

// Data Pruning Function for daily data (older than 2 years)
async function pruneOldDailyData() {
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 2);
  cutoffDate.setDate(cutoffDate.getDate() - 1); // 2 years before the app's "today"
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setMinutes(0);
  cutoffDate.setSeconds(0);
  cutoffDate.setMilliseconds(0);

  try {
    const result = await Stocks.deleteMany({
      granularity: "daily",
      date: { $lt: cutoffDate },
    });
    console.log(
      `Successfully pruned ${result.deletedCount} daily data points older than 2 years.`
    );
  } catch (error) {
    console.error("Error during pruning of old daily data:", error);
  }
}

async function fetchCompaniesData() {
  const companies = await Company.find();
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`Workspaceing data for: ${company.symbol}`);
    fetchAndStoreYesterdayIntradayData(company.symbol, company._id);
    // Wait for 20 seconds before processing the next company
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  console.log(`Workspaced 1min data for all Companies successfully`);
}

async function removeYesterdayOneMinuteData() {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 2);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setMinutes(0);
    yesterday.setSeconds(0);
    yesterday.setMilliseconds(0);

    const tomorrowYesterday = new Date(yesterday);
    tomorrowYesterday.setDate(tomorrowYesterday.getDate() + 1);
    tomorrowYesterday.setHours(0, 0, 0, 0);
    tomorrowYesterday.setMinutes(0);
    tomorrowYesterday.setSeconds(0);
    tomorrowYesterday.setMilliseconds(0);

    const result = await Stocks.deleteMany({
      granularity: "1min",
      date: { $gte: yesterday, $lt: tomorrowYesterday },
    });

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");

    console.log(
      `Successfully removed ${result.deletedCount} documents of 1-min data for ${year}-${month}-${day}`
    );
  } catch (error) {
    console.error("Error removing yesterday's 1-min data:", error);
  }
}

async function fetchAndStoreYesterdayFiveMinuteData(symbol, company_id) {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setMinutes(0);
    yesterday.setSeconds(0);
    yesterday.setMilliseconds(0);

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayFormatted = `${year}-${month}-${day}`;

    console.log(`Workspaceing 5-min data for: ${yesterdayFormatted}`);
    const functionParam = "TIME_SERIES_INTRADAY";
    const interval = "5min"; // Set the interval to 5 minutes

    const options = {
      method: "GET",
      url: RAPIDAPI_BASE_URL_INTRADAY,
      params: {
        datatype: "json",
        function: functionParam,
        symbol: symbol,
        interval: interval,
        outputsize: "full", // Fetch all available intraday data for yesterday
      },
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOSTNAME,
      },
    };

    const response = await axios.request(options);
    const data = response.data;

    if (data && data[`Time Series (${interval})`]) {
      const timeSeries = data[`Time Series (${interval})`];

      for (const timestampStr in timeSeries) {
        const intradayData = timeSeries[timestampStr];
        const timestampDate = new Date(timestampStr);
        const timestampYear = timestampDate.getFullYear();
        const timestampMonth = String(timestampDate.getMonth() + 1).padStart(
          2,
          "0"
        );
        const timestampDay = String(timestampDate.getDate()).padStart(2, "0");
        const timestampDateFormatted = `${timestampYear}-${timestampMonth}-${timestampDay}`;

        // Ensure the data point is from yesterday
        if (timestampDateFormatted === yesterdayFormatted) {
          const newStockData = new Stocks({
            company_id: company_id,
            date: timestampDate,
            open_price: parseFloat(intradayData["1. open"]),
            high_price: parseFloat(intradayData["2. high"]),
            low_price: parseFloat(intradayData["3. low"]),
            close_price: parseFloat(intradayData["4. close"]),
            volume: parseInt(intradayData["5. volume"]),
            granularity: "5min",
          });
          await newStockData.save();
        }
      }
      console.log(
        `Workspaceed and stored 5-min data for ${symbol} for yesterday (${yesterdayFormatted})`
      );
    } else if (data && data.Note) {
      console.warn(`Alpha Vantage API Note for ${symbol}: ${data.Note}`);
    } else if (data && data["Error Message"]) {
      console.error(
        `Alpha Vantage API Error for ${symbol}: ${data["Error Message"]}`
      );
    } else {
      console.warn(
        `No 5-min intraday data found for ${symbol} for yesterday (${yesterdayFormatted}) in Alpha Vantage response.`
      );
    }
  } catch (error) {
    console.error(
      `Error fetching or storing 5-min intraday data: `,
      error.message
    );
  }
}

async function fetchCompaniesDataFiveMinuteData() {
  const companies = await Company.find();
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`Workspaceing data for: ${company.symbol}`);
    fetchAndStoreYesterdayFiveMinuteData(company.symbol, company._id);
    // Wait for 20 seconds before processing the next company
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  console.log(`Workspaced 5min data for all Companies successfully`);
}

// Schedule tasks
cron.schedule("15 14 * * *", aggregateDailyData); // 4 Run at 00:45 every day
cron.schedule("30 14 * * *", pruneOldGranularData); // 5 Run at 00:30 every day
cron.schedule("20 14 * * *", pruneOldDailyData); // 6 Run at 01:00 every day
cron.schedule("3 13 * * *", removeYesterdayOneMinuteData); // 1 Run at 00:00 every day
cron.schedule("50 13 * * *", fetchCompaniesDataFiveMinuteData); // 3 Run at 01:00 every day
cron.schedule("10 13 * * *", fetchCompaniesData); // 2 Schedule to fetch yesterday's intraday data at 00 :05 for this days trade in app

module.exports = router;
