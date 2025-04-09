const express = require("express");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const Stocks = require("../models/Stocks");
const UserStocks = require("../models/UserStocks");
const Company = require("../models/Company");
const fetchUser = require("../middleware/fetchUser");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const router = express.Router();

// GET route for portfolio data for a specific user
router.get("/getPortfolio", fetchUser, async (req, res) => {
  const userId = req.user.id;
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, error: "User ID parameter is required." });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    // ACTION VERIFIED CAN RETURN USER PORTFOLIO
    try {
      const userBalance = user.balance || 0;

      const portfolioData = await Portfolio.findOne({ user_id: userId }).lean();
      if (!portfolioData) {
        return res.status(200).json({
          success: true,
          data: { stocks: [], Balance: userBalance },
        });
      }

      const userStocks = await UserStocks.find({
        portfolio_id: portfolioData._id,
      }).lean();

      if (!userStocks || userStocks.length === 0) {
        return res.status(200).json({
          success: true,
          data: { stocks: [], Balance: userBalance },
        });
      }

      const companyIds = [
        ...new Set(
          userStocks.map((stock) => stock.company_id).filter((id) => id != null)
        ),
      ];

      let companyMap = {};
      if (companyIds.length > 0) {
        const companies = await Company.find(
          {
            _id: { $in: companyIds },
          },
          "name symbol _id"
        ).lean();

        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);

        const latestStockData = await Stocks.aggregate([
          {
            $match: {
              company_id: { $in: companyIds },
              date: { $lte: yesterday },
            },
          },
          {
            $sort: {
              date: -1,
            },
          },
          {
            $group: {
              _id: "$company_id",
              latest_doc_id: { $first: "$_id" },
              current_price: { $first: "$close_price" },
              latestDate: { $first: "$date" },
            },
          },
          // Stage 4: (Optional) Reshape the output documents
          {
            $project: {
              _id: 0,
              company_id: "$_id", // Rename the group key back to company_id
              current_price: 1, // Include the latest current_price
              latestDate: 1, // Include the date associated with this price
            },
          },
        ]);

        const current_priceMap = latestStockData.reduce((map, stockInfo) => {
          map[stockInfo.company_id.toString()] = stockInfo.current_price || 0;
          return map;
        }, {});

        companyMap = companies.reduce((map, company) => {
          map[company._id.toString()] = {
            name: company.name || "N/A",
            symbol: company.symbol || "N/A",
            current_price: current_priceMap[company._id.toString()] || 0,
          };
          return map;
        }, {});
      } else {
        console.log(
          `[${new Date().toISOString()}] No valid company IDs found in user stocks.`
        );
      }

      const portfolioStocks = userStocks
        .map((userStock) => {
          const companyDetails = companyMap[
            userStock.company_id?.toString()
          ] || {
            name: "Unknown",
            symbol: "N/A",
            current_price: 0,
          };
          return {
            // Use company_id string as the 'id' in the response
            id: userStock.company_id?.toString() || "unknown",
            name: companyDetails.name,
            symbol: companyDetails.symbol,
            quantity: userStock.quantity || 0,
            average_price: userStock.average_price || 0,
            current_price: companyDetails.current_price, // Use fetched current price
          };
        })
        .filter((stock) => stock.id !== "unknown"); // Filter out stocks where company_id was missing

      const responseData = {
        stocks: portfolioStocks,
        Balance: userBalance,
      };

      res.status(200).json({ success: true, data: responseData });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Internal server error while fetching portfolio.",
      });
    }
  } catch (error) {
    if (!res.headersSent) {
      res
        .status(500)
        .json({ success: false, error: "Invalid Request or server error." });
    }
  }
});

router.get("/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, error: "User ID is required." });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, msg: "User not found." });
    }
    if (user.profileType === "Private") {
      return res.status(403).json({
        success: false,
        msg: "Access denied: This is a private profile.",
      });
    }
    try {
      const userBalance = user.balance || 0;

      const portfolioData = await Portfolio.findOne({ user_id: userId }).lean();
      if (!portfolioData) {
        return res.status(200).json({
          success: true,
          data: { stocks: [], Balance: userBalance },
        });
      }

      const userStocks = await UserStocks.find({
        portfolio_id: portfolioData._id,
      }).lean();

      if (!userStocks || userStocks.length === 0) {
        return res.status(200).json({
          success: true,
          data: { stocks: [], Balance: userBalance },
        });
      }

      const companyIds = [
        ...new Set(
          userStocks.map((stock) => stock.company_id).filter((id) => id != null)
        ),
      ];

      let companyMap = {};
      if (companyIds.length > 0) {
        const companies = await Company.find(
          {
            _id: { $in: companyIds },
          },
          "name symbol _id"
        ).lean();

        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);

        const latestStockData = await Stocks.aggregate([
          {
            $match: {
              company_id: { $in: companyIds },
              date: { $lte: yesterday },
            },
          },
          {
            $sort: {
              date: -1,
            },
          },
          {
            $group: {
              _id: "$company_id",
              latest_doc_id: { $first: "$_id" },
              current_price: { $first: "$close_price" },
              latestDate: { $first: "$date" },
            },
          },
          // Stage 4: (Optional) Reshape the output documents
          {
            $project: {
              _id: 0,
              company_id: "$_id", // Rename the group key back to company_id
              current_price: 1, // Include the latest current_price
              latestDate: 1, // Include the date associated with this price
            },
          },
        ]);

        const current_priceMap = latestStockData.reduce((map, stockInfo) => {
          map[stockInfo.company_id.toString()] = stockInfo.current_price || 0;
          return map;
        }, {});

        companyMap = companies.reduce((map, company) => {
          map[company._id.toString()] = {
            name: company.name || "N/A",
            symbol: company.symbol || "N/A",
            current_price: current_priceMap[company._id.toString()] || 0,
          };
          return map;
        }, {});
      } else {
        console.log(
          `[${new Date().toISOString()}] No valid company IDs found in user stocks.`
        );
      }

      const portfolioStocks = userStocks
        .map((userStock) => {
          const companyDetails = companyMap[
            userStock.company_id?.toString()
          ] || {
            name: "Unknown",
            symbol: "N/A",
            current_price: 0,
          };
          return {
            id: userStock.company_id?.toString() || "unknown",
            name: companyDetails.name,
            symbol: companyDetails.symbol,
            quantity: userStock.quantity || 0,
            average_price: userStock.average_price || 0,
            current_price: companyDetails.current_price, 
          };
        })
        .filter((stock) => stock.id !== "unknown"); 

      const responseData = {
        stocks: portfolioStocks,
        Balance: userBalance,
      };

      res.status(200).json({ success: true, data: responseData });
    } catch (error) {
      res.status(500).json({
        success: false,
        msg: "Internal server error while fetching portfolio.",
      });
    }
  } catch (error) {
    if (!res.headersSent) {
      res
        .status(500)
        .json({ success: false, msg: "Invalid Request or server error." });
    }
  }
});

module.exports = router;
