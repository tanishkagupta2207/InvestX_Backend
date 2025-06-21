const express = require("express");
const fetchUser = require("../middleware/fetchUser");
const Transactions = require("../models/Transactions");
const Company = require("../models/Company");
const Portfolio = require("../models/Portfolio");
const User = require("../models/User");
const UserStocks = require("../models/UserStocks");
const Orders = require("../models/Orders");

const router = express.Router();

router.post("/fetch", fetchUser, async (req, res) => {
  let success = false;
  
  const {action} = req.body;
  // Validate action
  if (action && (action !== "Buy" && action !== "Sell")) {
    return res.status(400).json({
      success,
      msg: "Invalid action. Must be 'Buy' or 'Sell'.",
    });
  }

  try {
    const userId = req.user.id;

    const queryConditions = { user_id: userId };

    if (action) {
      queryConditions.action = action; // Filter by action if provided
    }

    const transactions = await Transactions.find(queryConditions).lean();

    // Fetching company for each transaction
    for (let transaction of transactions) {
      const company = await Company.findById(transaction.company_id);
      if (company) {
        transaction.company = company.name;
      } else {
        transaction.company = "Unknown";
      }
    }
    success = true;
    res.json({ success, transactions });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success, msg: "Internal error" });
  }
});

// POST route for market orders
router.post("/market", fetchUser, async (req, res) => {
  const { quantity, price, action, companyId } = req.body;
  const userId = req.user.id;
  const quantityNum = parseInt(req.body.quantity, 10);

  if (!quantityNum || !price || !action || !companyId) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing required fields" });
  }

  //check for trading hours
  const now = new Date();
  const hour = now.getHours();
  const isMarketDay = now.getDay() >= 2 && now.getDay() <= 6; //one day behind schedule
  // Market hours: 4:00 AM (4) to 8:00 PM (20)
  const isMarketOpenTime =
    (hour > 4 || (hour === 4 && now.getMinutes() >= 0)) &&
    (hour < 20 || (hour === 20 && now.getMinutes() === 0));

  if (!(isMarketDay && isMarketOpenTime)) {
    return res.status(400).json({
      success: false,
      msg: "Action not allowed during non market hours.",
    });
  }

  let amountToAdd = quantityNum * price;
  if (action === "BUY") {
    amountToAdd *= -1;
  }
  try {
    //user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    // portfolio
    const portfolio = await Portfolio.findOne({ user_id: userId });
    if (!portfolio) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }
    const userStock = await UserStocks.findOne({
      portfolio_id: portfolio._id,
      company_id: companyId,
    });

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, Company not registered",
      });
    }

    // basic checks if needed balance present or not, sellable quantity of stock
    if (action === "SELL") {
      if (!userStock || userStock.quantity < quantityNum) {
        return res.status(400).json({
          success: false,
          msg: "Not enough quantity of shares to sell!",
        });
      }
    } else {
      if (user.balance + amountToAdd < 0) {
        return res
          .status(400)
          .json({ success: false, msg: "Not enough balance!" });
      }
    }
    now.setDate(now.getDate() - 1);
    const updation_time = new Date();
    //transaction mei will save
    const transaction = await Transactions.create({
      user_id: userId,
      company_id: companyId,
      action: action === "BUY" ? "Buy" : "Sell",
      trade_price: price,
      quantity: quantityNum,
      date: updation_time,
    });

    //create an order
    const order = await Orders.create({
      user_id: userId,
      portfolio_id: portfolio._id,
      company_id: companyId,
      order_type: action === "BUY" ? "Buy" : "Sell",
      order_sub_type: "MARKET",
      quantity: quantityNum,
      price: price,
      filled_quantity: quantityNum,
      average_fill_price: price,
      status: "FILLED",
      order_updation_date: updation_time,
      date: now,
    });

    // update user balance
    user.balance += amountToAdd;
    const updatedUser = await user.save();

    //userStocks mei will go and average price update
    if (userStock) {
      if (action === "BUY") {
        const oldTotal = userStock.average_price * userStock.quantity;
        const total = oldTotal - amountToAdd;
        userStock.quantity += quantityNum;
        userStock.average_price = total / userStock.quantity;
        const updatedUserStock = await userStock.save();
      } else {
        userStock.quantity -= quantityNum;
        if (userStock.quantity === 0) {
          await UserStocks.deleteOne({ _id: userStock._id });
        } else {
          const updatedUserStock = await userStock.save();
        }
      }
    } else {
      const updatedUserStock = await UserStocks.create({
        portfolio_id: portfolio._id,
        company_id: companyId,
        quantity: quantityNum,
        average_price: price,
      });
    }
    res.status(201).json({
      success: true,
      msg: "Order placed successfully",
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// POST route for limit orders
router.post("/limit", fetchUser, async (req, res) => {
  const { quantity, limit_price, action, companyId, time_in_force } = req.body;
  const userId = req.user.id;
  const quantityNum = parseInt(req.body.quantity, 10);

  if (!quantityNum || !limit_price || !action || !companyId || !time_in_force) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing required fields" });
  }

  //check for trading hours
  const now = new Date();
  const hour = now.getHours();
  const isMarketDay = now.getDay() >= 2 && now.getDay() <= 6; //one day behind schedule
  // Market hours: 4:00 AM (4) to 8:00 PM (20)
  const isMarketOpenTime =
    (hour > 4 || (hour === 4 && now.getMinutes() >= 0)) &&
    (hour < 20 || (hour === 20 && now.getMinutes() === 0));

  if (!(isMarketDay && isMarketOpenTime)) {
    return res.status(400).json({
      success: false,
      msg: "Orders can't be placed during non market hours.",
    });
  }

  try {
    //user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    // portfolio
    const portfolio = await Portfolio.findOne({ user_id: userId });
    if (!portfolio) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, Company not registered",
      });
    }

    now.setDate(now.getDate() - 1);

    //create an order
    const order = await Orders.create({
      user_id: userId,
      portfolio_id: portfolio._id,
      company_id: companyId,
      order_type: action === "BUY" ? "Buy" : "Sell",
      order_sub_type: "LIMIT",
      quantity: quantityNum,
      limit_price: limit_price,
      status: "PENDING",
      time_in_force: time_in_force,
      date: now,
    });

    res.status(201).json({
      success: true,
      msg: "Order placed successfully",
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// POST route for stop loss orders
router.post("/stopLoss", fetchUser, async (req, res) => {
  const { quantity, stop_price, action, companyId, time_in_force } = req.body;
  const userId = req.user.id;
  const quantityNum = parseInt(req.body.quantity, 10);

  if (!quantityNum || !stop_price || !action || !companyId || !time_in_force) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing required fields" });
  }

  //check for trading hours
  const now = new Date();
  const hour = now.getHours();
  const isMarketDay = now.getDay() >= 2 && now.getDay() <= 6; //one day behind schedule
  // Market hours: 4:00 AM (4) to 8:00 PM (20)
  const isMarketOpenTime =
    (hour > 4 || (hour === 4 && now.getMinutes() >= 0)) &&
    (hour < 20 || (hour === 20 && now.getMinutes() === 0));

  if (!(isMarketDay && isMarketOpenTime)) {
    return res.status(400).json({
      success: false,
      msg: "Orders can't be placed during non market hours.",
    });
  }

  try {
    //user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    // portfolio
    const portfolio = await Portfolio.findOne({ user_id: userId });
    if (!portfolio) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, Company not registered",
      });
    }

    now.setDate(now.getDate() - 1);

    //create an order
    const order = await Orders.create({
      user_id: userId,
      portfolio_id: portfolio._id,
      company_id: companyId,
      order_type: action === "BUY" ? "Buy" : "Sell",
      order_sub_type: "STOP_LOSS",
      quantity: quantityNum,
      stop_price: stop_price,
      status: "PENDING",
      time_in_force: time_in_force,
      date: now,
    });

    res.status(201).json({
      success: true,
      msg: "Order placed successfully",
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// POST route for stop limit orders
router.post("/stopLimit", fetchUser, async (req, res) => {
  const {
    quantity,
    stop_price,
    limit_price,
    action,
    companyId,
    time_in_force,
  } = req.body;
  const userId = req.user.id;
  const quantityNum = parseInt(req.body.quantity, 10);

  if (
    !quantityNum ||
    !stop_price ||
    !limit_price ||
    !action ||
    !companyId ||
    !time_in_force
  ) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing required fields" });
  }

  //check for trading hours
  const now = new Date();
  const hour = now.getHours();
  const isMarketDay = now.getDay() >= 2 && now.getDay() <= 6; //one day behind schedule
  // Market hours: 4:00 AM (4) to 8:00 PM (20)
  const isMarketOpenTime =
    (hour > 4 || (hour === 4 && now.getMinutes() >= 0)) &&
    (hour < 20 || (hour === 20 && now.getMinutes() === 0));

  if (!(isMarketDay && isMarketOpenTime)) {
    return res.status(400).json({
      success: false,
      msg: "Orders can't be placed during non market hours.",
    });
  }

  try {
    //user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    // portfolio
    const portfolio = await Portfolio.findOne({ user_id: userId });
    if (!portfolio) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, Company not registered",
      });
    }

    now.setDate(now.getDate() - 1);

    //create an order
    const order = await Orders.create({
      user_id: userId,
      portfolio_id: portfolio._id,
      company_id: companyId,
      order_type: action === "BUY" ? "Buy" : "Sell",
      order_sub_type: "STOP_LIMIT",
      quantity: quantityNum,
      stop_price: stop_price,
      limit_price: limit_price,
      status: "PENDING",
      time_in_force: time_in_force,
      date: now,
    });

    res.status(201).json({
      success: true,
      msg: "Order placed successfully",
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// POST route for stop limit orders
router.post("/takeProfit", fetchUser, async (req, res) => {
  const { quantity, take_profit_price, action, companyId, time_in_force } =
    req.body;
  const userId = req.user.id;
  const quantityNum = parseInt(req.body.quantity, 10);

  if (
    !quantityNum ||
    !take_profit_price ||
    !action ||
    !companyId ||
    !time_in_force
  ) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing required fields" });
  }

  //check for trading hours
  const now = new Date();
  const hour = now.getHours();
  const isMarketDay = now.getDay() >= 2 && now.getDay() <= 6; //one day behind schedule
  // Market hours: 4:00 AM (4) to 8:00 PM (20)
  const isMarketOpenTime =
    (hour > 4 || (hour === 4 && now.getMinutes() >= 0)) &&
    (hour < 20 || (hour === 20 && now.getMinutes() === 0));

  if (!(isMarketDay && isMarketOpenTime)) {
    return res.status(400).json({
      success: false,
      msg: "Orders can't be placed during non market hours.",
    });
  }

  try {
    //user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    // portfolio
    const portfolio = await Portfolio.findOne({ user_id: userId });
    if (!portfolio) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, User not registered",
      });
    }

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(400).json({
        success: false,
        msg: "Action not allowed, Company not registered",
      });
    }

    now.setDate(now.getDate() - 1);

    //create an order
    const order = await Orders.create({
      user_id: userId,
      portfolio_id: portfolio._id,
      company_id: companyId,
      order_type: action === "BUY" ? "Buy" : "Sell",
      order_sub_type: "TAKE_PROFIT",
      quantity: quantityNum,
      take_profit_price: take_profit_price,
      status: "PENDING",
      time_in_force: time_in_force,
      date: now,
    });

    res.status(201).json({
      success: true,
      msg: "Order placed successfully",
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

module.exports = router;
