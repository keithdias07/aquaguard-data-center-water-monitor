import pandas as pd

# Load the dataset
df = pd.read_csv("data/sensor_data.csv")

# Show the first 5 rows
print("First 5 rows:")
print(df.head())

# Show information about the dataset
print("\nDataset information:")
print(df.info())

# Show statistical summary
print("\nStatistical summary:")
print(df.describe())

# Show the number of rows and columns
print("\nDataset shape:")
print(df.shape)