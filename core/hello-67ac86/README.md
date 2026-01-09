# hello.cpp: A Basic "Hello, World!" C++ Program

`hello.cpp` is a minimalistic C++ program designed to demonstrate the fundamental process of writing, compiling, and executing a simple C++ application. Its sole purpose is to print the classic "Hello, World!" message to the standard output (console). This program serves as an excellent starting point for anyone new to C++ or for quickly verifying a C++ development environment setup.

## Features

*   **Simple Console Output**: Prints a fixed string to the console.
*   **Fundamental C++ Structure**: Illustrates the basic `main` function and the use of the `iostream` library.
*   **Easy to Understand**: Ideal for beginners to grasp core C++ concepts.
*   **Environment Verification**: A quick test to ensure your C++ compiler and build tools are correctly installed and configured.

## Usage

To compile and run this program, you will need a C++ compiler installed on your system (e.g., g++ on Linux/macOS, MinGW on Windows, or Visual Studio C++).

### 1. Save the Code

Save the provided C++ code into a file named `hello.cpp`:

```cpp
#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
```

### 2. Compile the Program

Open a terminal or command prompt, navigate to the directory where you saved `hello.cpp`, and use a C++ compiler to compile the source code. For `g++`:

```bash
g++ hello.cpp -o hello
```

This command compiles `hello.cpp` and creates an executable file named `hello` (or `hello.exe` on Windows).

### 3. Run the Program

Execute the compiled program from your terminal:

```bash
./hello
```

On Windows, you might type `hello.exe` or `hello`.

### 4. Expected Output

Upon successful execution, the program will display the following output in your console:

```
Hello, World!
```