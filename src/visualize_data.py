import pandas as pd
import matplotlib.pyplot as plt

# Load the dataset
df = pd.read_csv("data/sensor_data.csv")

# Create a scatter plot
plt.scatter(
    df["server_load_percent"],
    df["water_consumption_liters"]
)

plt.xlabel("Server Load (%)")
plt.ylabel("Water Consumption (Liters)")
plt.title("Server Load vs Water Consumption")

plt.show()