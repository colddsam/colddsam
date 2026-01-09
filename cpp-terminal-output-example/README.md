# hello.cpp - Simple C++ "Hello, World!" Program

This repository contains `hello.cpp`, a minimalistic C++ program designed to demonstrate the most basic functionality of C++: printing text to the console. It serves as a classic "Hello, World!" example, often used as a starting point for learning a new programming language or verifying a development environment setup.

## Description

The `hello.cpp` file contains a single C++ source file that utilizes the standard input/output stream library (`<iostream>`) to print the string "Hello, World!" followed by a newline character to the standard output. The program then exits with a successful status code.

## Features

*   **Classic "Hello, World!"**: A fundamental example for C++ beginners.
*   **Minimalistic Code**: Demonstrates the core structure of a C++ program with minimal boilerplate.
*   **Standard Library Usage**: Utilizes `std::cout` and `std::endl` from the `<iostream>` header.
*   **Console Output**: Prints a predefined string directly to the terminal.
*   **Cross-Platform**: Compilable and runnable on any system with a C++ compiler (e.g., GCC, Clang, MSVC).

## Usage

To compile and run this program, you will need a C++ compiler installed on your system. The following instructions assume you are using `g++`, a common C++ compiler.

1.  **Save the Code**:
    Save the provided C++ code into a file named `hello.cpp`.

    ```cpp
    #include <iostream>

    int main() {
        std::cout << "Hello, World!" << std::endl;
        return 0;
    }
    ```

2.  **Compile the Program**:
    Open a terminal or command prompt, navigate to the directory where you saved `hello.cpp`, and compile it using a C++ compiler.

    ```bash
    g++ hello.cpp -o hello
    ```
    This command compiles `hello.cpp` and creates an executable file named `hello` (or `hello.exe` on Windows).

3.  **Run the Executable**:
    Execute the compiled program from your terminal.

    ```bash
    ./hello
    ```
    On Windows, you might run it as `.\hello.exe` or `hello.exe`.

4.  **Expected Output**:
    Upon successful execution, the program will print the following to your console:

    ```
    Hello, World!
    ```