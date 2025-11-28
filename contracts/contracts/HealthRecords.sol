// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract HealthRecords {
    mapping(address => string) public records;

    event RecordUpdated(address indexed patient, string cid);

    function setRecord(string calldata cid) external {
        records[msg.sender] = cid;
        emit RecordUpdated(msg.sender, cid);
    }

    function getRecord(address patient) external view returns (string memory) {
        return records[patient];
    }
}
