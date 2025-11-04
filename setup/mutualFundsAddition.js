const mongoose = require("mongoose");
const MutualFund = require("../models/MutualFund");
const connectToMongoDB = require("../dbConnect");

const mutualFundsData = [
  {
    name: "Mirae Asset Large Cap Fund - Growth Plan",
    scheme_code: "107578",
    fund_house: "Mirae Asset Mutual Fund",
    category: "Large_Cap",
    risk_category: "Medium Risk",
  },
  {
    name: "ICICI Prudential Large & Mid Cap Fund - Growth",
    scheme_code: "100349",
    fund_house: "ICICI Prudential Mutual Fund",
    category: "Large_Cap",
    risk_category: "Medium Risk",
  },
  {
    name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
    scheme_code: "122639",
    fund_house: "PPFAS Mutual Fund",
    category: "Large_Cap",
    risk_category: "Medium Risk",
  },
  {
    name: "UTI Nifty 50 Index Fund - Growth Option- Direct",
    scheme_code: "120716",
    fund_house: "UTI Mutual Fund",
    category: "Large_Cap",
    risk_category: "Medium Risk",
  },
  {
    name: "HDFC Large Cap Fund - Growth Option - Direct Plan",
    scheme_code: "119018",
    fund_house: "HDFC Mutual Fund",
    category: "Large_Cap",
    risk_category: "Medium Risk",
  },
  {
    name: "Kotak Global Emerging Market Fund - Growth - Direct",
    scheme_code: "119779",
    fund_house: "Kotak Mutual Fund",
    category: "Mid_Cap",
    risk_category: "High Risk",
  },
  {
    name: "Tata Mid Cap Fund - Direct Plan- Growth Option",
    scheme_code: "119178",
    fund_house: "Tata Mutual Fund",
    category: "Mid_Cap",
    risk_category: "High Risk",
  },
  {
    name: "Axis Large & Mid Cap Fund - Direct Plan - Growth",
    scheme_code: "145110",
    fund_house: "Axis Mutual Fund",
    category: "Mid_Cap",
    risk_category: "High Risk",
  },
  {
    name: "JM Large & Mid Cap Fund (Direct) - Growth Option",
    scheme_code: "153629",
    fund_house: "JM Financial Mutual Fund",
    category: "Mid_Cap",
    risk_category: "High Risk",
  },
  {
    name: "DSP Large & Mid Cap Fund - Direct Plan - Growth",
    scheme_code: "119218",
    fund_house: "DSP Mutual Fund",
    category: "Mid_Cap",
    risk_category: "High Risk",
  },
  {
    name: "HSBC Small Cap Fund - Direct Growth",
    scheme_code: "151130",
    fund_house: "HSBC Mutual Fund",
    category: "Small_Cap",
    risk_category: "Very High Risk",
  },
  {
    name: "Tata Small Cap Fund-Direct Plan-Growth",
    scheme_code: "145206",
    fund_house: "Tata Mutual Fund",
    category: "Small_Cap",
    risk_category: "Very High Risk",
  },
  {
    name: "Axis Small Cap Fund - Direct Plan - Growth",
    scheme_code: "125354",
    fund_house: "Axis Mutual Fund",
    category: "Small_Cap",
    risk_category: "Very High Risk",
  },
  {
    name: "JM Small Cap Fund (Direct) - Growth Option",
    scheme_code: "152614",
    fund_house: "JM Financial Mutual Fund",
    category: "Small_Cap",
    risk_category: "Very High Risk",
  },
  {
    name: "Kotak-Small Cap Fund - Growth - Direct",
    scheme_code: "120164",
    fund_house: "Kotak Mahindra Mutual Fund",
    category: "Small_Cap",
    risk_category: "Very High Risk",
  },
  {
    name: "Kotak Aggressive Hybrid Fund - Direct Plan -Growth",
    scheme_code: "133035",
    fund_house: "Kotak Mahindra Mutual Fund",
    category: "Hybrid",
    risk_category: "Moderately High Risk",
  },
  {
    name: "ICICI Prudential Equity & Debt Fund - Direct Plan - Growth",
    scheme_code: "120251",
    fund_house: "ICICI Prudential Mutual Fund",
    category: "Hybrid",
    risk_category: "Moderately High Risk",
  },
  {
    name: "HDFC Balanced Advantage Fund - Growth Plan - Direct Plan",
    scheme_code: "118968",
    fund_house: "HDFC Mutual Fund",
    category: "Hybrid",
    risk_category: "Moderately High Risk",
  },
  {
    name: "SBI EQUITY HYBRID FUND - DIRECT PLAN - Growth",
    scheme_code: "119609",
    fund_house: "SBI Mutual Fund",
    category: "Hybrid",
    risk_category: "Moderately High Risk",
  },
  {
    name: "CANARA ROBECO EQUITY HYBRID FUND - DIRECT PLAN - GROWTH OPTION",
    scheme_code: "118272",
    fund_house: "Canara Robeco Mutual Fund",
    category: "Hybrid",
    risk_category: "Moderately High Risk",
  },
  {
    name: "HDFC Liquid Fund - Growth Option - Direct Plan",
    scheme_code: "119091",
    fund_house: "HDFC Mutual Fund",
    category: "Debt",
    risk_category: "Low Risk",
  },
  {
    name: "Kotak Liquid Fund - Direct Plan - Growth",
    scheme_code: "119766",
    fund_house: "Kotak Mutual Fund",
    category: "Debt",
    risk_category: "Low Risk",
  },
  {
    name: "SBI Liquid Fund - DIRECT PLAN -Growth",
    scheme_code: "119800",
    fund_house: "SBI Mutual Fund",
    category: "Debt",
    risk_category: "Low Risk",
  },
  {
    name: "Aditya Birla Sun Life Liquid Fund - Growth - Direct Plan",
    scheme_code: "119568",
    fund_house: "Aditya Birla Sun Life Mutual Fund",
    category: "Debt",
    risk_category: "Low Risk",
  },
  {
    name: "ICICI Prudential Debt Management Fund (FOF) - Direct Plan - Growth",
    scheme_code: "120702",
    fund_house: "ICICI Prudential Mutual Fund",
    category: "Debt",
    risk_category: "Low Risk",
  },
];

async function seedMutualFunds() {
  try {
    const result = await MutualFund.insertMany(mutualFundsData, { ordered: false });
    
    console.log(`Successfully added ${result.length} new mutual funds.`);
    console.log("All mutual funds have been processed.");

  } catch (error) {
    if (error.code === 11000) {
        console.error("Some mutual funds already exist in the database. No duplicates were added.");
    } else {
        console.error("Error adding mutual funds:", error);
    }
  }
}

connectToMongoDB();
seedMutualFunds();