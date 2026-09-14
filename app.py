import streamlit as st
import pandas as pd
import plotly.express as px

# Page configuration
st.set_page_config(
    page_title="AquaGuard",
    page_icon="💧",
    layout="wide"
)

# Load the data
df = pd.read_csv("data/water_wastage_results.csv")

# Convert timestamp to datetime
df["timestamp"] = pd.to_datetime(df["timestamp"])

# Page title
st.title("💧 AquaGuard")
st.subheader("AI Data Center Water Waste Monitor")

st.write(
    "Monitor cooling-water consumption and identify unusual usage patterns."
)

# Calculate metrics
total_water = df["water_consumption_liters"].sum()
anomalies = (df["anomaly"] == -1).sum()
total_excess = df["estimated_excess_water"].sum()

# Water wastage alert
if total_excess > 20000:
    st.warning(
        f"⚠️ High water wastage detected! "
        f"Estimated excess consumption: {total_excess:,.0f} liters."
    )
else:
    st.success("Water consumption is within the expected range.")
# Metrics
col1, col2, col3 = st.columns(3)

with col1:
    st.metric(
        "Total Water Consumption",
        f"{total_water:,.0f} L"
    )

with col2:
    st.metric(
        "Anomalies Detected",
        anomalies
    )

with col3:
    st.metric(
        "Estimated Excess Water",
        f"{total_excess:,.0f} L"
    )

# Water consumption chart
st.subheader("Water Consumption Over Time")

fig = px.line(
    df,
    x="timestamp",
    y="water_consumption_liters",
    title="Hourly Water Consumption",
    labels={
        "timestamp": "Time",
        "water_consumption_liters": "Water Consumption (Liters)"
    }
)

st.plotly_chart(fig, use_container_width=True)

# Scatter plot
st.subheader("Server Load vs Water Consumption")

df["status"] = df["anomaly"].map({
    1: "Normal",
    -1: "Anomaly"
})

fig2 = px.scatter(
    df,
    x="server_load_percent",
    y="water_consumption_liters",
    color="status",
    title="Water Consumption by Server Load",
    labels={
        "server_load_percent": "Server Load (%)",
        "water_consumption_liters": "Water Consumption (Liters)",
        "status": "Reading Status"
    }
)

st.plotly_chart(fig2, use_container_width=True)

# Anomalies table
st.subheader("Detected Water Waste Events")

anomalies_df = df[df["anomaly"] == -1]

st.dataframe(
    anomalies_df[
        [
            "timestamp",
            "server_load_percent",
            "water_consumption_liters",
            "expected_water_consumption",
            "estimated_excess_water"
        ]
    ],
    use_container_width=True
)