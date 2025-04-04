const router = require("express").Router();
const cron = require("node-cron");
const Stocks = require("../models/Stocks");
const Company = require("../models/Company");
const axios = require("axios");
require("dotenv").config();

// Data Fetching API Endpoint
router.get("/:company_id", async (req, res) => {
    res.json("TODO");
  //   const { company_id } = req.params;
  //   const range = req.query.range || "today";
  //   const now = new Date();
  //   const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  //   try {
  //     let data = [];
  //     if (range === "today") {
  //       const startTime = new Date(today);
  //       const endTime = now;
  //       data = await Stocks.find({
  //         company_id: company_id,
  //         granularity: "2min",
  //         date: { $gte: startTime, $lte: endTime },
  //       }).sort({ date: 1 });
  //     } else if (range === "last_4_days") {
  //       const endDate = new Date(today);
  //       endDate.setDate(endDate.getDate()); // including today
  //       const startDate = new Date(endDate);
  //       startDate.setDate(startDate.getDate() - 3);
  //       const startTime = new Date(
  //         startDate.getFullYear(),
  //         startDate.getMonth(),
  //         startDate.getDate()
  //       );
  //       const endTime = new Date(
  //         endDate.getFullYear(),
  //         endDate.getMonth(),
  //         endDate.getDate(),
  //         23,
  //         59,
  //         59,
  //         999
  //       );
  //       data = await Stocks.find({
  //         company_id: company_id,
  //         date: { $gte: startTime, $lte: endTime },
  //       }).sort({ date: 1 });
  //     } else if (range === "last_2_years") {
  //       const endDate = new Date(today);
  //       endDate.setDate(endDate.getDate() - 1); // Consider data up to yesterday
  //       const startDate = new Date(endDate);
  //       startDate.setFullYear(startDate.getFullYear() - 2);
  //       const startTime = new Date(
  //         startDate.getFullYear(),
  //         startDate.getMonth(),
  //         startDate.getDate()
  //       );
  //       const endTime = new Date(
  //         endDate.getFullYear(),
  //         endDate.getMonth(),
  //         endDate.getDate(),
  //         23,
  //         59,
  //         59,
  //         999
  //       );
  //       data = await Stocks.find({
  //         company_id: company_id,
  //         date: { $gte: startTime, $lte: endTime },
  //       }).sort({ date: 1 });
  //     } else {
  //       return res.status(400).json({ error: "Invalid range parameter" });
  //     }
  //     res.json(data);
  //   } catch (error) {
  //     console.error("Error fetching stock data:", error);
  //     res.status(500).json({ error: "Failed to fetch stock data" });
  //   }
});

// RapidAPI Configuration
const RAPIDAPI_KEY = process.env.REACT_APP_RAPIDAPI_KEY;
const RAPIDAPI_HOSTNAME = process.env.REACT_APP_RAPIDAPI_HOSTNAME;
const RAPIDAPI_BASE_URL_INTRADAY = process.env.REACT_APP_RAPIDAPI_BASE_URL_INTRADAY;
const INTRADAY_INTERVAL = "1min";

async function fetchAndStoreYesterdayIntradayData(symbol, company_id) {
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
cron.schedule("15 21 * * *", aggregateDailyData); // Run at 00:45 every day
cron.schedule("20 21 * * *", pruneOldGranularData); // Run at 00:30 every day
cron.schedule("30 21 * * *", pruneOldDailyData); // Run at 01:00 every day
cron.schedule("10 20 * * *", removeYesterdayOneMinuteData); // Run at 00:00 every day
cron.schedule("50 20 * * *", fetchCompaniesDataFiveMinuteData); // Run at 01:00 every day
cron.schedule("15 20 * * *", fetchCompaniesData); // Schedule to fetch yesterday's intraday data at 00 :05 for this days trade in app

module.exports = router;
