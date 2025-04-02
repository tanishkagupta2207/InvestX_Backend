// Import necessary libraries
const yahooFinance = require("yahoo-finance2").default; // Note the .default import
const Company = require("../models/Company");
const Stocks = require("../models/Stocks");
const connectToMongoDB = require("../dbConnect");

// --- Date Calculation ---
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
yesterday.setHours(0, 0, 0, 0);
const startDate = new Date();
startDate.setFullYear(startDate.getFullYear() - 2); // Set start date to 2 years ago

// Format dates for yahoo-finance2 (YYYY-MM-DD)
const formatYMD = (date) => date.toISOString().split("T")[0];
const period1 = formatYMD(startDate);
const period2 = formatYMD(yesterday); //app is 1 day behind from actual calendar

// --- Data Fetching ---
async function fetchHistoricalData(symbol) {
  console.log(
    `Workspaceing data for ${symbol} from ${period1} to ${period2}...`
  );
  try {
    const queryOptions = {
      period1: period1, // Start date
      period2: period2, // End date
      interval: "1d", // '1d' for daily, '1wk' for weekly, '1mo' for monthly
      // includeAdjustedClose: true // Usually included by default
    };
    // Use the historical method from yahoo-finance2
    const results = await yahooFinance.historical(symbol, queryOptions);
    console.log(`Workspaceed ${results.length} records for ${symbol}.`);
    return results;
  } catch (error) {
    console.error(`Error fetching data for ${symbol}:`, error.message);
    // Check for common errors like 'Not Found' if the symbol is invalid
    if (
      error.name === "FailedYahooValidationError" ||
      error.message.includes("404")
    ) {
      console.warn(`Symbol ${symbol} might be invalid or delisted. Skipping.`);
    } else {
      // Log other errors more verbosely if needed
      console.error(error); // Uncomment for full error details
    }
    return null; // Return null to indicate failure for this symbol
  }
}

// --- Data Storage ---
async function storeHistoricalData(symbol, data, companyId) {
  if (!data || data.length === 0) {
    console.log(`No data provided to store for ${symbol}.`);
    return;
  }

  // Prepare data for MongoDB: Add symbol and ensure date is a Date object
  const documents = data.map((record) => ({
    company_id: companyId,
    date: new Date(record.date), // Convert string date to BSON Date object
    open_price: record.open,
    high_price: record.high,
    low_price: record.low,
    close_price: record.adjClose,
    volume: record.volume,
    granularity: "daily",
  }));

  // Use bulkWrite with upsert to efficiently insert or update records
  const bulkOps = documents.map((doc) => ({
    updateOne: {
      filter: { company_id: doc.companyId, date: doc.date }, // Find document by symbol and date
      update: { $set: doc }, // Set all fields (update if exists)
      upsert: true, // Insert if it doesn't exist
    },
  }));

  try {
    if (bulkOps.length > 0) {
      const result = await Stocks.bulkWrite(bulkOps);
      console.log(
        `Stored data for ${symbol}. Matched: ${result.matchedCount}, Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}`
      );
    } else {
      console.log(`No documents prepared for bulk write for ${symbol}.`);
    }
  } catch (error) {
    console.error(`Error storing data for ${symbol} in MongoDB:`, error);
    // Handle specific bulk write errors if necessary (e.g., index constraint violations)
    if (error.code === 11000) {
      // E11000 duplicate key error
      console.error(
        `Duplicate key error likely prevented by upsert, but check index/data for ${symbol}.`
      );
    }
  }
}

// --- Main Execution ---
async function run() {
  await connectToMongoDB();
  console.log("Starting stock data fetch process...");

  try {
    const companies = await Company.find();
    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      const historicalData = await fetchHistoricalData(company.symbol);
      if (historicalData) {
        await storeHistoricalData(company.symbol, historicalData, company._id);
      }
      // Optional: Add a small delay between requests to be polite to the API source
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
    }
    console.log("Finished processing all Companies.");
  } catch (error) {
    console.error(
      "An unexpected error occurred during the main process:",
      error
    );
  }
}

run();
