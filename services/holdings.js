// Helper: Fetch token balances (all chains) from Covalent
const holdingsCache = {};
const CACHE_TTL = 1000 * 60 * 60 * 5; // ✅ 5 hours

const COVALENT_API_KEY= process.env.COVALENT_API_KEY;
const COVALENT_BASE_URL= process.env.COVALENT_BASE_URL;

const getHoldings = async (walletAddress, chainId, currency = "usd") => {
    const cacheKey = `${walletAddress}_${chainId}_${currency}`;
    const now = Date.now();
  
    // ✅ Serve cached data if still valid
    // if (holdingsCache[cacheKey] && holdingsCache[cacheKey].expiry > now) {
    //   //console.log("Serving from cache:", cacheKey);
    //   return holdingsCache[cacheKey].data;
    // }
  
    try {
      const res = await fetch(
        `${COVALENT_BASE_URL}/${chainId}/address/${walletAddress}/balances_v2/?key=${COVALENT_API_KEY}&quote-currency=${currency}`
      );      
      const result = await res.json();
      console.log("Covalent API response:", result);
      if (!result || !result.data || !result.data.items) return [];
  
      const holdings = result.data.items.map((t) => {
        const amount =
          parseFloat(t.balance) / Math.pow(10, t.contract_decimals || 18);
        const currentPrice = t.quote_rate || 0;
        const totalValue = t.quote || amount * currentPrice;
  
        return {
          chainId,
          symbol: t.contract_ticker_symbol,
          name: t.contract_name,
          address: t.contract_address,
          amount,
          currentPrice, // ✅ actual token price
          totalValue, // ✅ USD value
          change24h: t.quote_24h || 0, // ✅ 24h change if available
          imageUrl: t.logo_url || "/default-token-icon.png",
        };
      });
  
      // ✅ Save to cache with 5-hour expiry
      // holdingsCache[cacheKey] = {
      //   data: holdings,
      //   expiry: now + CACHE_TTL,
      // };
  
      return holdings;
    } catch (error) {
      console.error("Error fetching Covalent holdings:", error);
      return [];
    }
  };

module.exports = {
  getHoldings
}